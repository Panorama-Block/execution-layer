import { ethers } from "ethers";
import { getEnabledStakingPools } from "../config/staking-pools";
import { getContract } from "../../../providers/chain.provider";
import { GAUGE_ABI, POOL_ABI } from "../../../utils/abi";
import { aerodromeService } from "../../../shared/services/aerodrome.service";
import { createCache, getCached, getStale, setCache } from "../../../shared/cache";
import { logger } from "../../../shared/logger";

type DexScreenerMetrics = {
  feeAPR: string | null;
  tvlUsd: number | null;
};

// Granular caches for APR/TVL and gauge data
const dexMetricsCache = createCache<DexScreenerMetrics>();
const DEX_METRICS_TTL = 30_000; // 30s for APR + TVL

const gaugeDataCache = createCache<{ rewardRate: bigint; totalStaked: bigint }>();
const GAUGE_DATA_TTL = 60_000; // 60s for gauge rewards

/** Fetch fee-based APR and real TVL from DexScreener (cached 30s). */
async function fetchDexScreenerMetrics(poolAddress: string, feeRate: number): Promise<DexScreenerMetrics> {
  const cacheKey = `dex:${poolAddress.toLowerCase()}:${feeRate}`;
  const cached = getCached(dexMetricsCache, cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/base/${poolAddress}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { feeAPR: null, tvlUsd: null };
    const json = await res.json() as { pairs?: { volume?: { h24?: number }; liquidity?: { usd?: number } }[] };
    const pair = json.pairs?.[0];
    const tvlUsd = pair?.liquidity?.usd ?? null;
    const vol24h = pair?.volume?.h24 ?? null;

    if (!tvlUsd || tvlUsd <= 0 || !vol24h || vol24h <= 0) {
      const result: DexScreenerMetrics = { feeAPR: null, tvlUsd };
      setCache(dexMetricsCache, cacheKey, result, DEX_METRICS_TTL);
      return result;
    }

    const feeAPR = (vol24h * feeRate * 365) / tvlUsd * 100;
    logger.info({ chain: "base", vol24h: vol24h.toFixed(0), tvl: tvlUsd.toFixed(0), feeRate, feeAPR: `${feeAPR.toFixed(2)}%` }, "DexScreener APR calculated");
    const result: DexScreenerMetrics = { feeAPR: `${feeAPR.toFixed(2)}%`, tvlUsd };
    setCache(dexMetricsCache, cacheKey, result, DEX_METRICS_TTL);
    return result;
  } catch (e) {
    logger.error({ chain: "base", pool: poolAddress, error: e instanceof Error ? e.message : e }, "DexScreener fetch failed");
    // Return stale value if available
    const stale = getStale(dexMetricsCache, cacheKey);
    if (stale) {
      logger.warn({ chain: "base", pool: poolAddress }, "Using stale DexScreener cache");
      return stale.value;
    }
    return { feeAPR: null, tvlUsd: null };
  }
}

/** Best-effort gauge call with short timeout (no retries — these are non-critical). */
async function safeGaugeCall(gauge: ethers.Contract, method: string): Promise<bigint> {
  try {
    return await Promise.race([
      gauge[method]() as Promise<bigint>,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2500)),
    ]);
  } catch {
    return 0n;
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
  aprSource: string;
  aprDisclaimer: string;
  totalLiquidityUsd: string | null;
}

export interface GetProtocolInfoResponse {
  protocol: string;
  chain: string;
  pools: PoolInfo[];
  updatedAt: string;
  stale?: boolean;
}

let cache: { data: GetProtocolInfoResponse; expiresAt: number } | null = null;
const CACHE_TTL = 30_000; // 30s — individual caches (dex 30s, gauge 60s) handle per-resource freshness

export async function executeGetProtocolInfo(): Promise<GetProtocolInfoResponse> {
  if (cache && Date.now() < cache.expiresAt) {
    logger.info({ protocol: "aerodrome", expiresInSec: Math.round((cache.expiresAt - Date.now()) / 1000) }, "Returning cached protocol info");
    return cache.data;
  }

  try {
    logger.info({ protocol: "aerodrome" }, "Cache miss, fetching fresh on-chain data");
    const enabledPools = getEnabledStakingPools();
    logger.info({ protocol: "aerodrome", pools: enabledPools.map(p => p.name) }, "Enabled pools loaded");

    const poolResults = await Promise.all(enabledPools.map(async (pool): Promise<PoolInfo | null> => {
      try {
        logger.info({ protocol: "aerodrome", pool: pool.name }, "Processing pool");
        const { poolAddress, gaugeAddress } = await aerodromeService.withRetry(() =>
          aerodromeService.resolvePoolAndGauge(pool)
        );
        logger.info({ protocol: "aerodrome", pool: pool.name, poolAddress, gaugeAddress }, "Pool and gauge resolved");

        const feeRate = pool.stable ? 0.0001 : 0.003;

        // Gauge data cached 60s; DexScreener cached 30s.
        const gaugeCacheKey = `gauge:${gaugeAddress.toLowerCase()}`;
        let gaugeData = getCached(gaugeDataCache, gaugeCacheKey);
        const dexPromise = fetchDexScreenerMetrics(poolAddress, feeRate);

        if (!gaugeData) {
          const gauge = getContract(gaugeAddress, GAUGE_ABI, "base");
          const [rewardRate, totalStaked] = await Promise.all([
            safeGaugeCall(gauge, "rewardRate"),
            safeGaugeCall(gauge, "totalSupply"),
          ]);
          gaugeData = { rewardRate, totalStaked };
          setCache(gaugeDataCache, gaugeCacheKey, gaugeData, GAUGE_DATA_TTL);
        }

        const dexMetrics = await dexPromise;
        const { rewardRate, totalStaked } = gaugeData;

        let estimatedAPR = "0";
        let aprSource = "unavailable";
        let totalLiquidityUsd: string | null = null;

        if (dexMetrics.tvlUsd != null && Number.isFinite(dexMetrics.tvlUsd)) {
          totalLiquidityUsd = dexMetrics.tvlUsd.toFixed(2);
        }

        if (dexMetrics.feeAPR) {
          estimatedAPR = dexMetrics.feeAPR.replace("%", "");
          aprSource    = "DexScreener fee APR (24h volume × fee rate × 365 / TVL)";
          logger.info({ protocol: "aerodrome", pool: pool.name, feeAPR: `${estimatedAPR}%` }, "Fee APR from DexScreener");
        }

        logger.info({ protocol: "aerodrome", pool: pool.name, estimatedAPR: `${estimatedAPR}%` }, "Estimated APR computed");

        return {
          poolId: pool.id,
          poolName: pool.name,
          poolAddress,
          gaugeAddress,
          stable: pool.stable,
          rewardRatePerSecond: rewardRate.toString(),
          totalStaked: totalStaked.toString(),
          estimatedAPR: `${estimatedAPR}%`,
          aprSource,
          aprDisclaimer: "Fee APR estimate only. Does not include AERO gauge rewards. Past performance is not indicative of future results.",
          totalLiquidityUsd,
        };
      } catch (err) {
        logger.error({ protocol: "aerodrome", pool: pool.name, error: err instanceof Error ? err.message : err }, "Pool resolution failed entirely");
        return null;
      }
    }));

    const pools = poolResults.filter((p): p is PoolInfo => p !== null);

    logger.info({ protocol: "aerodrome", poolCount: pools.length, aprs: pools.map(p => `${p.poolName}=${p.estimatedAPR}`) }, "Protocol info fetch complete");

    const data: GetProtocolInfoResponse = {
      protocol: "Aerodrome Finance",
      chain: "Base (8453)",
      pools,
      updatedAt: new Date().toISOString(),
    };

    cache = { data, expiresAt: Date.now() + CACHE_TTL };
    return data;
  } catch (err) {
    // On total failure, return stale cache if available
    if (cache) {
      logger.warn({ protocol: "aerodrome", lastUpdated: cache.data.updatedAt, error: err instanceof Error ? err.message : err }, "Fetch failed, returning stale cache");
      return { ...cache.data, stale: true };
    }
    throw err;
  }
}
