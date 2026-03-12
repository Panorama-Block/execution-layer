import { ethers } from "ethers";
import { getEnabledStakingPools } from "../config/staking-pools";
import { getContract } from "../../../providers/chain.provider";
import { GAUGE_ABI, POOL_ABI } from "../../../utils/abi";
import { aerodromeService } from "../../../shared/services/aerodrome.service";

type DexScreenerMetrics = {
  feeAPR: string | null;
  tvlUsd: number | null;
};

/** Fetch fee-based APR and real TVL from DexScreener. */
async function fetchDexScreenerMetrics(poolAddress: string, feeRate: number): Promise<DexScreenerMetrics> {
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
      return { feeAPR: null, tvlUsd };
    }

    const feeAPR = (vol24h * feeRate * 365) / tvlUsd * 100;
    console.log(`[APR-DEXSCREENER] vol24h=$${vol24h.toFixed(0)}, tvl=$${tvlUsd.toFixed(0)}, feeRate=${feeRate}, feeAPR=${feeAPR.toFixed(2)}%`);
    return { feeAPR: `${feeAPR.toFixed(2)}%`, tvlUsd };
  } catch (e) {
    console.error(`[APR-DEXSCREENER] Failed:`, e instanceof Error ? e.message : e);
    return { feeAPR: null, tvlUsd: null };
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
  totalLiquidityUsd: string | null;
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
      const { poolAddress, gaugeAddress } = await aerodromeService.withRetry(() =>
        aerodromeService.resolvePoolAndGauge(pool)
      );
      console.log(`[PROTOCOL-INFO]   poolAddress=${poolAddress}, gaugeAddress=${gaugeAddress}`);

      const gauge = getContract(gaugeAddress, GAUGE_ABI, "base");

      let rewardRate = 0n;
      let totalStaked = 0n;
      try {
        rewardRate = await aerodromeService.withRetry(() => gauge.rewardRate());
        console.log(`[PROTOCOL-INFO]   rewardRate=${rewardRate.toString()}`);
      } catch (e) {
        console.error(`[PROTOCOL-INFO]   rewardRate FAILED:`, e instanceof Error ? e.message : e);
      }
      try {
        totalStaked = await aerodromeService.withRetry(() => gauge.totalSupply());
        console.log(`[PROTOCOL-INFO]   totalStaked=${totalStaked.toString()}`);
      } catch (e) {
        console.error(`[PROTOCOL-INFO]   totalSupply FAILED:`, e instanceof Error ? e.message : e);
      }

      let estimatedAPR = "0";
      let totalLiquidityUsd: string | null = null;
      if (totalStaked > 0n && rewardRate > 0n) {
        const secondsPerYear = 365n * 24n * 3600n;
        const yearlyRewards  = rewardRate * secondsPerYear;
        const aprBps         = (yearlyRewards * 10000n) / totalStaked;
        estimatedAPR = (Number(aprBps) / 100).toFixed(2);
      }

      const feeRate   = pool.stable ? 0.0001 : 0.003; // 1bp stable, 30bp volatile
      const dexMetrics = await fetchDexScreenerMetrics(poolAddress, feeRate);
      if (dexMetrics.tvlUsd != null && Number.isFinite(dexMetrics.tvlUsd)) {
        totalLiquidityUsd = dexMetrics.tvlUsd.toFixed(2);
      }

      // If on-chain APR is 0 or absurdly high (>10000%), use DexScreener fee APR.
      const aprNum = parseFloat(estimatedAPR);
      if (aprNum === 0 || aprNum > 10000) {
        const dexAPR = dexMetrics.feeAPR;
        if (dexAPR) {
          console.log(`[PROTOCOL-INFO]   Using DexScreener APR: ${dexAPR} (on-chain was ${estimatedAPR}%)`);
          estimatedAPR = dexAPR.replace("%", "");
        }
      }
      console.log(`[PROTOCOL-INFO]   estimatedAPR=${estimatedAPR}%`);
      if (totalLiquidityUsd != null) {
        console.log(`[PROTOCOL-INFO]   totalLiquidityUsd=$${totalLiquidityUsd}`);
      }

      pools.push({
        poolId: pool.id,
        poolName: pool.name,
        poolAddress,
        gaugeAddress,
        stable: pool.stable,
        rewardRatePerSecond: rewardRate.toString(),
        totalStaked: totalStaked.toString(),
        estimatedAPR: `${estimatedAPR}%`,
        totalLiquidityUsd,
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
