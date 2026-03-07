import { ethers } from "ethers";
import { getEnabledStakingPools } from "../config/staking-pools";
import { getPoolAddress } from "../../../providers/aerodrome.provider";
import { getGaugeForPool, getStakedBalance, getEarnedRewards } from "../../../providers/gauge.provider";

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

export async function executeGetPosition(
  req: GetPositionRequest
): Promise<GetPositionResponse> {
  const enabledPools = getEnabledStakingPools();
  const positions: StakingPosition[] = [];

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

      const [stakedBalance, earnedRewards] = await Promise.all([
        getStakedBalance(gaugeAddress, req.userAddress),
        getEarnedRewards(gaugeAddress, req.userAddress),
      ]);

      if (stakedBalance > 0n) {
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
      // Skip pools that fail to load
    }
  }

  return { positions };
}
