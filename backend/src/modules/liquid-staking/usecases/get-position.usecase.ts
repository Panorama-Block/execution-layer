import { ethers } from "ethers";
import { getEnabledStakingPools } from "../config/staking-pools";
import { getPoolAddress } from "../../../providers/aerodrome.provider";
import { getGaugeForPool, getStakedBalance, getEarnedRewards } from "../../../providers/gauge.provider";
import { getUserAdapterAddress } from "../../../config/protocols";

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

function withTimeout<T>(fn: () => Promise<T>, ms = 8000): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function safeBigInt(fn: () => Promise<bigint>): Promise<bigint> {
  try {
    return await withTimeout(fn);
  } catch {
    return 0n;
  }
}

export async function executeGetPosition(
  req: GetPositionRequest
): Promise<GetPositionResponse> {
  const enabledPools = getEnabledStakingPools();

  // Run adapter lookup and pool resolution in parallel
  const [userAdapter, poolResults] = await Promise.all([
    getUserAdapterAddress(req.userAddress, "aerodrome"),
    Promise.all(enabledPools.map(async (pool) => {
      try {
        const poolAddress = await withTimeout(() => getPoolAddress(
          pool.tokenA.address, pool.tokenB.address, pool.stable
        ));
        if (poolAddress === ethers.ZeroAddress) return null;
        const gaugeAddress = await withTimeout(() => getGaugeForPool(poolAddress));
        if (gaugeAddress === ethers.ZeroAddress) return null;
        return { pool, poolAddress, gaugeAddress };
      } catch {
        return null;
      }
    })),
  ]);

  console.log(`[POSITIONS] user=${req.userAddress}, adapter=${userAdapter}, pools=${enabledPools.length}`);

  // Fetch staking positions in parallel
  const results = await Promise.all(
    poolResults.filter(Boolean).map(async (result): Promise<StakingPosition | null> => {
      const { pool, poolAddress, gaugeAddress } = result!;
      try {
        const [stakedBalance, earnedRewards] = await Promise.all([
          userAdapter ? safeBigInt(() => getStakedBalance(gaugeAddress, userAdapter)) : Promise.resolve(0n),
          userAdapter ? safeBigInt(() => getEarnedRewards(gaugeAddress, userAdapter)) : Promise.resolve(0n),
        ]);

        console.log(`[POSITIONS] ${pool.name}: staked=${stakedBalance}, earned=${earnedRewards}`);

        if (stakedBalance > 0n || earnedRewards > 0n) {
          return {
            poolId: pool.id, poolName: pool.name, poolAddress, gaugeAddress,
            tokenA: pool.tokenA, tokenB: pool.tokenB, stable: pool.stable,
            stakedBalance: stakedBalance.toString(),
            earnedRewards: earnedRewards.toString(),
            rewardToken: pool.rewardToken,
          };
        }
        return null;
      } catch {
        return null;
      }
    })
  );

  return { positions: results.filter((p): p is StakingPosition => p !== null) };
}
