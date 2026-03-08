import { ethers } from "ethers";
import { getEnabledStakingPools } from "../config/staking-pools";
import { getPoolAddress } from "../../../providers/aerodrome.provider";
import { getGaugeForPool, getRewardRate } from "../../../providers/gauge.provider";
import { getContract } from "../../../providers/chain.provider";
import { GAUGE_ABI, POOL_ABI } from "../../../utils/abi";

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
    return cache.data;
  }

  const enabledPools = getEnabledStakingPools();
  const pools: PoolInfo[] = [];

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

      const gauge = getContract(gaugeAddress, GAUGE_ABI, "base");
      const [rewardRate, totalStaked] = await Promise.all([
        gauge.rewardRate().catch(() => 0n),
        gauge.totalSupply().catch(() => 0n),
      ]);

      // Estimate APR: (rewardRate * secondsPerYear) / totalStaked * 100
      let estimatedAPR = "0";
      if (totalStaked > 0n) {
        const secondsPerYear = 365n * 24n * 3600n;
        const yearlyRewards = rewardRate * secondsPerYear;
        // APR as percentage with 2 decimal precision
        const aprBps = (yearlyRewards * 10000n) / totalStaked;
        estimatedAPR = (Number(aprBps) / 100).toFixed(2);
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
      });
    } catch {
      // Skip pools that fail
    }
  }

  const data: GetProtocolInfoResponse = {
    protocol: "Aerodrome Finance",
    chain: "Base (8453)",
    pools,
    updatedAt: new Date().toISOString(),
  };

  cache = { data, expiresAt: Date.now() + CACHE_TTL };
  return data;
}
