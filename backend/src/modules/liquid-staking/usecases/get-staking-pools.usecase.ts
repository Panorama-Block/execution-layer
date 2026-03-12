import { getEnabledStakingPools } from "../config/staking-pools";
import { getContract } from "../../../providers/chain.provider";
import { getProtocolConfig } from "../../../config/protocols";
import { GAUGE_ABI, VOTER_ABI } from "../../../utils/abi";
import { aerodromeService } from "../../../shared/services/aerodrome.service";

interface StakingPoolInfo {
  id: string;
  name: string;
  tokenA: { symbol: string; address: string; decimals: number };
  tokenB: { symbol: string; address: string; decimals: number };
  stable: boolean;
  poolAddress: string;
  gaugeAddress: string;
  gaugeAlive: boolean;
  rewardToken: { symbol: string; address: string; decimals: number };
  totalStaked: string;
  rewardRate: string;
}

export interface GetStakingPoolsResponse {
  pools: StakingPoolInfo[];
}

let cache: { data: GetStakingPoolsResponse; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60 * 1000;

async function safeCall<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await aerodromeService.withTimeout(fn);
  } catch {
    return fallback;
  }
}

export async function executeGetStakingPools(): Promise<GetStakingPoolsResponse> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.data;
  }

  const enabledPools = getEnabledStakingPools();
  const config = getProtocolConfig("aerodrome");

  const poolResults = await Promise.all(enabledPools.map(async (pool) => {
    try {
      const resolved = await aerodromeService.resolvePoolAndGauge(pool);
      const { poolAddress, gaugeAddress } = resolved;

      const voter = getContract(config.contracts.voter, VOTER_ABI, "base");
      const gauge = getContract(gaugeAddress, GAUGE_ABI, "base");

      const [gaugeAlive, totalStaked, rewardRate] = await Promise.all([
        safeCall(() => voter.isAlive(gaugeAddress) as Promise<boolean>, true),
        safeCall(() => gauge.totalSupply() as Promise<bigint>, 0n),
        safeCall(() => aerodromeService.getRewardRate(gaugeAddress), 0n),
      ]);

      return {
        id: pool.id,
        name: pool.name,
        tokenA: pool.tokenA,
        tokenB: pool.tokenB,
        stable: pool.stable,
        poolAddress,
        gaugeAddress,
        gaugeAlive,
        rewardToken: pool.rewardToken,
        totalStaked: totalStaked.toString(),
        rewardRate: rewardRate.toString(),
      };
    } catch (err) {
      console.error(
        `[STAKING/POOLS] Failed to resolve pool ${pool.name}:`,
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }));

  const data: GetStakingPoolsResponse = {
    pools: poolResults.filter((pool): pool is StakingPoolInfo => pool !== null),
  };
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}
