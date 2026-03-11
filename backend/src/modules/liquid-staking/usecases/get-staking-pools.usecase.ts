import { ethers } from "ethers";
import { getEnabledStakingPools } from "../config/staking-pools";
import { getPoolAddress } from "../../../providers/aerodrome.provider";
import { getGaugeForPool, getRewardRate } from "../../../providers/gauge.provider";
import { getContract } from "../../../providers/chain.provider";
import { getProtocolConfig } from "../../../config/protocols";
import { GAUGE_ABI, VOTER_ABI } from "../../../utils/abi";

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

async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 500): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
    }
  }
  throw new Error("Unreachable");
}

function withTimeout<T>(fn: () => Promise<T>, ms = 2500): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function safeCall<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await withTimeout(fn);
  } catch {
    return fallback;
  }
}

async function resolvePoolAndGaugeAddresses(pool: ReturnType<typeof getEnabledStakingPools>[number]): Promise<{ poolAddress: string; gaugeAddress: string } | null> {
  const poolAddress = pool.poolAddress && pool.poolAddress !== ethers.ZeroAddress
    ? pool.poolAddress
    : await withRetry(() => withTimeout(() => getPoolAddress(
      pool.tokenA.address,
      pool.tokenB.address,
      pool.stable
    )));

  if (!poolAddress || poolAddress === ethers.ZeroAddress) return null;

  const gaugeAddress = pool.gaugeAddress && pool.gaugeAddress !== ethers.ZeroAddress
    ? pool.gaugeAddress
    : await withRetry(() => withTimeout(() => getGaugeForPool(poolAddress)));

  if (!gaugeAddress || gaugeAddress === ethers.ZeroAddress) return null;
  return { poolAddress, gaugeAddress };
}

export async function executeGetStakingPools(): Promise<GetStakingPoolsResponse> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.data;
  }

  const enabledPools = getEnabledStakingPools();
  const config = getProtocolConfig("aerodrome");
  const poolResults = await Promise.all(enabledPools.map(async (pool) => {
    try {
      const resolved = await resolvePoolAndGaugeAddresses(pool);
      if (!resolved) return null;
      const { poolAddress, gaugeAddress } = resolved;

      const voter = getContract(config.contracts.voter, VOTER_ABI, "base");
      const gauge = getContract(gaugeAddress, GAUGE_ABI, "base");

      // Do not drop the entire pool on partial RPC failures.
      const [gaugeAlive, totalStaked, rewardRate] = await Promise.all([
        safeCall(() => voter.isAlive(gaugeAddress) as Promise<boolean>, true),
        safeCall(() => gauge.totalSupply() as Promise<bigint>, 0n),
        safeCall(() => getRewardRate(gaugeAddress), 0n),
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
