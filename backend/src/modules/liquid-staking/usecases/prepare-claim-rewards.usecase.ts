import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { getStakingPoolById } from "../config/staking-pools";
import { getPoolAddress } from "../../../providers/aerodrome.provider";
import { getGaugeForPool, getEarnedRewards } from "../../../providers/gauge.provider";
import { GAUGE_ABI } from "../../../utils/abi";
import { PreparedTransaction } from "../../../types/transaction";

export interface PrepareClaimRewardsRequest {
  userAddress: string;
  poolId: string;
}

export interface PrepareClaimRewardsResponse {
  transaction: PreparedTransaction;
  metadata: {
    poolId: string;
    gaugeAddress: string;
    earnedRewards: string;
    rewardToken: { symbol: string; address: string; decimals: number };
  };
}

export async function executeClaimRewards(
  req: PrepareClaimRewardsRequest
): Promise<PrepareClaimRewardsResponse> {
  const poolConfig = getStakingPoolById(req.poolId);
  if (!poolConfig) {
    throw new Error(`Staking pool not found: ${req.poolId}`);
  }

  const chain = getChainConfig("base");

  // Resolve pool and gauge
  const poolAddress = await getPoolAddress(
    poolConfig.tokenA.address,
    poolConfig.tokenB.address,
    poolConfig.stable
  );
  if (poolAddress === ethers.ZeroAddress) {
    throw new Error(`Pool not found on-chain for ${poolConfig.name}`);
  }

  const gaugeAddress = await getGaugeForPool(poolAddress);
  if (gaugeAddress === ethers.ZeroAddress) {
    throw new Error(`Gauge not found for pool ${poolConfig.name}`);
  }

  const earnedRewards = await getEarnedRewards(gaugeAddress, req.userAddress);
  if (earnedRewards === 0n) {
    throw new Error(`No rewards to claim for ${poolConfig.name}`);
  }

  // Gauge.getReward(account) is called directly by the user (not through executor)
  const gaugeIface = new ethers.Interface(GAUGE_ABI);
  const data = gaugeIface.encodeFunctionData("getReward", [req.userAddress]);

  return {
    transaction: {
      to: gaugeAddress,
      data,
      value: "0",
      chainId: chain.chainId,
      description: `Claim ${poolConfig.rewardToken.symbol} rewards from ${poolConfig.name} gauge`,
    },
    metadata: {
      poolId: poolConfig.id,
      gaugeAddress,
      earnedRewards: earnedRewards.toString(),
      rewardToken: poolConfig.rewardToken,
    },
  };
}
