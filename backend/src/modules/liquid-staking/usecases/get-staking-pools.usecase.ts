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

export async function executeGetStakingPools(): Promise<GetStakingPoolsResponse> {
  const enabledPools = getEnabledStakingPools();
  const config = getProtocolConfig("aerodrome");
  const pools: StakingPoolInfo[] = [];

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

      const voter = getContract(config.contracts.voter, VOTER_ABI, "base");
      const gauge = getContract(gaugeAddress, GAUGE_ABI, "base");

      const [gaugeAlive, totalStaked, rewardRate] = await Promise.all([
        voter.isAlive(gaugeAddress) as Promise<boolean>,
        gauge.totalSupply() as Promise<bigint>,
        getRewardRate(gaugeAddress),
      ]);

      pools.push({
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
      });
    } catch {
      // Skip pools that fail to load
    }
  }

  return { pools };
}
