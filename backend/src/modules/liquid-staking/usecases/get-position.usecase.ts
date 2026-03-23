import { ethers } from "ethers";
import { getEnabledStakingPools } from "../config/staking-pools";
import { aerodromeService } from "../../../shared/services/aerodrome.service";

interface StakingPosition {
  poolId: string;
  poolName: string;
  poolAddress: string;
  gaugeAddress: string;
  tokenA: { symbol: string; address: string; decimals: number };
  tokenB: { symbol: string; address: string; decimals: number };
  stable: boolean;
  stakedBalance: string;
  walletLpBalance: string;
  earnedRewards: string;
  rewardToken: { symbol: string; address: string; decimals: number };
}

export interface GetPositionRequest {
  userAddress: string;
}

export interface GetPositionResponse {
  positions: StakingPosition[];
}

async function resolvePoolAndGauge(
  pool: ReturnType<typeof getEnabledStakingPools>[number]
): Promise<{ poolAddress: string; gaugeAddress: string } | null> {
  try {
    return await aerodromeService.resolvePoolAndGauge(pool);
  } catch {
    return null;
  }
}

export async function executeGetPosition(
  req: GetPositionRequest
): Promise<GetPositionResponse> {
  const enabledPools = getEnabledStakingPools();

  // Run adapter lookup and pool resolution in parallel
  const [userAdapter, poolResults] = await Promise.all([
    aerodromeService.getUserAdapterAddress(req.userAddress, "aerodrome"),
    Promise.all(enabledPools.map(async (pool) => {
      const resolved = await resolvePoolAndGauge(pool);
      if (!resolved) return null;
      return { pool, ...resolved };
    })),
  ]);

  console.log(`[POSITIONS] user=${req.userAddress}, adapter=${userAdapter}, pools=${enabledPools.length}`);

  // Fetch staking positions sequentially within each pool to avoid RPC rate limiting.
  // All pools still run in parallel (outer Promise.all), but within each pool the three
  // calls are awaited one-by-one, reducing peak concurrency from 21→7 simultaneous calls.
  const results = await Promise.all(
    poolResults.filter(Boolean).map(async (result): Promise<StakingPosition | null> => {
      const { pool, poolAddress, gaugeAddress } = result!;
      try {
        const stakedBalance = userAdapter
          ? await aerodromeService.withRetry(() => aerodromeService.getStakedBalance(gaugeAddress, userAdapter), 2, 300).catch(() => 0n)
          : 0n;
        const earnedRewards = userAdapter
          ? await aerodromeService.withRetry(() => aerodromeService.getEarnedRewards(gaugeAddress, userAdapter), 2, 300).catch(() => 0n)
          : 0n;
        const walletLpBalance = await aerodromeService
          .getTokenBalance(poolAddress, req.userAddress)
          .catch(() => 0n);

        console.log(`[POSITIONS] ${pool.name}: staked=${stakedBalance}, earned=${earnedRewards}, walletLp=${walletLpBalance}`);

        if (stakedBalance > 0n || earnedRewards > 0n || walletLpBalance > 0n) {
          return {
            poolId: pool.id, poolName: pool.name, poolAddress, gaugeAddress,
            tokenA: pool.tokenA, tokenB: pool.tokenB, stable: pool.stable,
            stakedBalance: stakedBalance.toString(),
            earnedRewards: earnedRewards.toString(),
            walletLpBalance: walletLpBalance.toString(),
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
