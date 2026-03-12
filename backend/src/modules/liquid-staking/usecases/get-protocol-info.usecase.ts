import { ethers } from "ethers";
import { getEnabledStakingPools } from "../config/staking-pools";
import { getPoolAddress } from "../../../providers/aerodrome.provider";
import { getGaugeForPool, getRewardRate } from "../../../providers/gauge.provider";
import { getContract } from "../../../providers/chain.provider";
import { GAUGE_ABI, POOL_ABI } from "../../../utils/abi";

async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 500): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error("withRetry exhausted");
}

/** Fetch fee-based APR from DexScreener as fallback */
async function fetchDexScreenerAPR(poolAddress: string, feeRate: number): Promise<string | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/base/${poolAddress}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { pairs?: { volume?: { h24?: number }; liquidity?: { usd?: number } }[] };
    const pair = json.pairs?.[0];
    if (!pair?.volume?.h24 || !pair?.liquidity?.usd || pair.liquidity.usd === 0) return null;
    const feeAPR = (pair.volume.h24 * feeRate * 365) / pair.liquidity.usd * 100;
    console.log(`[APR-DEXSCREENER] vol24h=$${pair.volume.h24.toFixed(0)}, tvl=$${pair.liquidity.usd.toFixed(0)}, feeRate=${feeRate}, feeAPR=${feeAPR.toFixed(2)}%`);
    return `${feeAPR.toFixed(2)}%`;
  } catch (e) {
    console.error(`[APR-DEXSCREENER] Failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

interface PoolInfo {
  poolId: string;
  poolName: string;
  poolAddress: string;
  gaugeAddress: string;
  stable: boolean;
  rewardRatePerSecond: string;
  totalStaked: string;
  estimatedAPR: string;
}

export interface GetProtocolInfoResponse {
  protocol: string;
  chain: string;
  pools: PoolInfo[];
  updatedAt: string;
}

let cache: { data: GetProtocolInfoResponse; expiresAt: number } | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export async function executeGetProtocolInfo(): Promise<GetProtocolInfoResponse> {
  if (cache && Date.now() < cache.expiresAt) {
    console.log("[PROTOCOL-INFO] Returning cached data (expires in", Math.round((cache.expiresAt - Date.now()) / 1000), "s)");
    return cache.data;
  }

  console.log("[PROTOCOL-INFO] Cache miss — fetching fresh data from on-chain...");
  const enabledPools = getEnabledStakingPools();
  console.log("[PROTOCOL-INFO] Enabled pools:", enabledPools.map(p => p.name).join(", "));
  const pools: PoolInfo[] = [];

  for (const pool of enabledPools) {
    try {
      console.log(`[PROTOCOL-INFO] Processing pool: ${pool.name}`);
      const poolAddress = await withRetry(() => getPoolAddress(
        pool.tokenA.address,
        pool.tokenB.address,
        pool.stable
      ));
      console.log(`[PROTOCOL-INFO]   poolAddress=${poolAddress}`);
      if (poolAddress === ethers.ZeroAddress) { console.log(`[PROTOCOL-INFO]   SKIP: pool is ZeroAddress`); continue; }

      const gaugeAddress = await withRetry(() => getGaugeForPool(poolAddress));
      console.log(`[PROTOCOL-INFO]   gaugeAddress=${gaugeAddress}`);
      if (gaugeAddress === ethers.ZeroAddress) { console.log(`[PROTOCOL-INFO]   SKIP: gauge is ZeroAddress`); continue; }

      const gauge = getContract(gaugeAddress, GAUGE_ABI, "base");

      let rewardRate = 0n;
      let totalStaked = 0n;
      try {
        rewardRate = await withRetry(() => gauge.rewardRate());
        console.log(`[PROTOCOL-INFO]   rewardRate=${rewardRate.toString()}`);
      } catch (e) {
        console.error(`[PROTOCOL-INFO]   rewardRate FAILED:`, e instanceof Error ? e.message : e);
      }
      try {
        totalStaked = await withRetry(() => gauge.totalSupply());
        console.log(`[PROTOCOL-INFO]   totalStaked=${totalStaked.toString()}`);
      } catch (e) {
        console.error(`[PROTOCOL-INFO]   totalSupply FAILED:`, e instanceof Error ? e.message : e);
      }

      // Estimate APR: try on-chain gauge first, then DexScreener fee APR as fallback
      let estimatedAPR = "0";
      if (totalStaked > 0n && rewardRate > 0n) {
        // On-chain: compare AERO rewards value vs LP staked value
        // Simplified: just use fee-based APR from DexScreener for accuracy
        const secondsPerYear = 365n * 24n * 3600n;
        const yearlyRewards = rewardRate * secondsPerYear;
        const aprBps = (yearlyRewards * 10000n) / totalStaked;
        estimatedAPR = (Number(aprBps) / 100).toFixed(2);
      }

      // If on-chain APR is 0 or absurdly high (>10000%), use DexScreener fee APR
      const aprNum = parseFloat(estimatedAPR);
      if (aprNum === 0 || aprNum > 10000) {
        const feeRate = pool.stable ? 0.0001 : 0.003; // 1bp stable, 30bp volatile
        const dexAPR = await fetchDexScreenerAPR(poolAddress, feeRate);
        if (dexAPR) {
          console.log(`[PROTOCOL-INFO]   Using DexScreener APR: ${dexAPR} (on-chain was ${estimatedAPR}%)`);
          estimatedAPR = dexAPR.replace("%", "");
        }
      }
      console.log(`[PROTOCOL-INFO]   estimatedAPR=${estimatedAPR}%`);

      pools.push({
        poolId: pool.id,
        poolName: pool.name,
        poolAddress,
        gaugeAddress,
        stable: pool.stable,
        rewardRatePerSecond: rewardRate.toString(),
        totalStaked: totalStaked.toString(),
        estimatedAPR: `${estimatedAPR}%`,
      });
    } catch (err) {
      console.error(`[PROTOCOL-INFO] Pool ${pool.name} FAILED entirely:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[PROTOCOL-INFO] Done. ${pools.length} pools resolved. APRs: ${pools.map(p => `${p.poolName}=${p.estimatedAPR}`).join(", ")}`);

  const data: GetProtocolInfoResponse = {
    protocol: "Aerodrome Finance",
    chain: "Base (8453)",
    pools,
    updatedAt: new Date().toISOString(),
  };

  cache = { data, expiresAt: Date.now() + CACHE_TTL };
  return data;
}
