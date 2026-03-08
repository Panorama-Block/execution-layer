import { ethers } from "ethers";
import { getEnabledStakingPools } from "../config/staking-pools";
import { getPoolAddress } from "../../../providers/aerodrome.provider";
import { getGaugeForPool, getStakedBalance, getEarnedRewards } from "../../../providers/gauge.provider";
import { getProtocolConfig } from "../../../config/protocols";

interface StakingPosition {
  poolId: string;
  poolName: string;
  poolAddress: string;
  gaugeAddress: string;
  tokenA: { symbol: string; address: string; decimals: number };
  tokenB: { symbol: string; address: string; decimals: number };
  stable: boolean;
  stakedBalance: string;
  earnedRewards: string;
  rewardToken: { symbol: string; address: string; decimals: number };
}

export interface GetPositionRequest {
  userAddress: string;
}

export interface GetPositionResponse {
  positions: StakingPosition[];
}

async function safeBigInt(fn: () => Promise<bigint>): Promise<bigint> {
  try {
    return await fn();
  } catch {
    return 0n;
  }
}

export async function executeGetPosition(
  req: GetPositionRequest
): Promise<GetPositionResponse> {
  const enabledPools = getEnabledStakingPools();
  const positions: StakingPosition[] = [];
  const adapterAddress = getProtocolConfig("aerodrome").adapterAddress;

  for (const pool of enabledPools) {
    try {
      const poolAddress = await getPoolAddress(
        pool.tokenA.address,
        pool.tokenB.address,
        pool.stable
      );
      if (poolAddress === ethers.ZeroAddress) continue;

      const gaugeAddress = await getGaugeForPool(poolAddress);
      if (gaugeAddress === ethers.ZeroAddress) continue;

      // Check both user direct position and adapter position.
      // The adapter stakes LP on behalf of users via the executor.
      const [adapterStaked, adapterEarned, userStaked, userEarned] = await Promise.all([
        adapterAddress ? safeBigInt(() => getStakedBalance(gaugeAddress, adapterAddress)) : Promise.resolve(0n),
        adapterAddress ? safeBigInt(() => getEarnedRewards(gaugeAddress, adapterAddress)) : Promise.resolve(0n),
        safeBigInt(() => getStakedBalance(gaugeAddress, req.userAddress)),
        safeBigInt(() => getEarnedRewards(gaugeAddress, req.userAddress)),
      ]);
      const stakedBalance = adapterStaked + userStaked;
      const earnedRewards = adapterEarned + userEarned;

      if (stakedBalance > 0n || earnedRewards > 0n) {
        positions.push({
          poolId: pool.id,
          poolName: pool.name,
          poolAddress,
          gaugeAddress,
          tokenA: pool.tokenA,
          tokenB: pool.tokenB,
          stable: pool.stable,
          stakedBalance: stakedBalance.toString(),
          earnedRewards: earnedRewards.toString(),
          rewardToken: pool.rewardToken,
        });
      }
    } catch {
      // Skip pools that fail entirely (e.g., pool doesn't exist)
    }
  }

  return { positions };
}
