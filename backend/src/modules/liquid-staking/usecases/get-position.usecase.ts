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

  // Fetch staking positions in parallel
  const results = await Promise.all(
    poolResults.filter(Boolean).map(async (result): Promise<StakingPosition | null> => {
      const { pool, poolAddress, gaugeAddress } = result!;
      try {
        const [stakedBalance, earnedRewards] = await Promise.all([
          userAdapter ? aerodromeService.safeBigInt(() => aerodromeService.getStakedBalance(gaugeAddress, userAdapter)) : Promise.resolve(0n),
          userAdapter ? aerodromeService.safeBigInt(() => aerodromeService.getEarnedRewards(gaugeAddress, userAdapter)) : Promise.resolve(0n),
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
