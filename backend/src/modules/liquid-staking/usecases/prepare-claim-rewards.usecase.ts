import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { getStakingPoolById } from "../config/staking-pools";
import { getPoolAddress } from "../../../providers/aerodrome.provider";
import { getGaugeForPool, getEarnedRewards } from "../../../providers/gauge.provider";
import { PANORAMA_EXECUTOR_ABI } from "../../../utils/abi";
import { encodeProtocolId } from "../../../utils/encoding";
import { getUserAdapterAddress } from "../../../config/protocols";
import { PreparedTransaction, TransactionBundle } from "../../../types/transaction";

export interface PrepareClaimRewardsRequest {
  userAddress: string;
  poolId: string;
}

export interface PrepareClaimRewardsResponse {
  bundle: TransactionBundle;
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
  const poolAddress = poolConfig.poolAddress && poolConfig.poolAddress !== ethers.ZeroAddress
    ? poolConfig.poolAddress
    : await getPoolAddress(
      poolConfig.tokenA.address,
      poolConfig.tokenB.address,
      poolConfig.stable
    );
  if (poolAddress === ethers.ZeroAddress) {
    throw new Error(`Pool not found on-chain for ${poolConfig.name}`);
  }

  const gaugeAddress = poolConfig.gaugeAddress && poolConfig.gaugeAddress !== ethers.ZeroAddress
    ? poolConfig.gaugeAddress
    : await getGaugeForPool(poolAddress);
  if (gaugeAddress === ethers.ZeroAddress) {
    throw new Error(`Gauge not found for pool ${poolConfig.name}`);
  }

  // Get user's adapter clone address and check earned rewards
  const userAdapter = await getUserAdapterAddress(req.userAddress, "aerodrome");
  const earnedRewards = userAdapter
    ? await getEarnedRewards(gaugeAddress, userAdapter).catch(() => 0n)
    : 0n;

  if (earnedRewards === 0n) {
    throw new Error(`No rewards to claim for ${poolConfig.name}`);
  }

  const executorAddress = chain.contracts.panoramaExecutor;
  const executorIface = new ethers.Interface(PANORAMA_EXECUTOR_ABI);
  const protocolId = encodeProtocolId("aerodrome");
  const extraData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [gaugeAddress]);

  const steps: PreparedTransaction[] = [{
    to: executorAddress,
    data: executorIface.encodeFunctionData("executeClaimRewards", [
      protocolId,
      poolAddress,
      extraData,
    ]),
    value: "0",
    chainId: chain.chainId,
    description: `Claim ${poolConfig.rewardToken.symbol} rewards from ${poolConfig.name}`,
  }];

  return {
    bundle: {
      steps,
      totalSteps: steps.length,
      summary: `Claim rewards from ${poolConfig.name}`,
    },
    metadata: {
      poolId: poolConfig.id,
      gaugeAddress,
      earnedRewards: earnedRewards.toString(),
      rewardToken: poolConfig.rewardToken,
    },
  };
}
