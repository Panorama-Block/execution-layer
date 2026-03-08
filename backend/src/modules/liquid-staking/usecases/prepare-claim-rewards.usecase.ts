import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { getProtocolConfig } from "../../../config/protocols";
import { getStakingPoolById } from "../config/staking-pools";
import { getPoolAddress } from "../../../providers/aerodrome.provider";
import { getGaugeForPool, getEarnedRewards, getStakedBalance } from "../../../providers/gauge.provider";
import { GAUGE_ABI, PANORAMA_EXECUTOR_ABI } from "../../../utils/abi";
import { encodeProtocolId } from "../../../utils/encoding";
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
  const protocol = getProtocolConfig("aerodrome");
  const adapterAddress = protocol.adapterAddress;

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

  // Check both adapter and user direct rewards
  const [adapterEarned, userEarned] = await Promise.all([
    adapterAddress ? getEarnedRewards(gaugeAddress, adapterAddress).catch(() => 0n) : Promise.resolve(0n),
    getEarnedRewards(gaugeAddress, req.userAddress).catch(() => 0n),
  ]);
  const earnedRewards = adapterEarned + userEarned;

  if (earnedRewards === 0n) {
    throw new Error(`No rewards to claim for ${poolConfig.name}`);
  }

  const steps: PreparedTransaction[] = [];

  if (adapterEarned > 0n && adapterAddress) {
    // The adapter holds the gauge position. The executor can't call getReward directly,
    // and executeUnstake(0) reverts. So we do a full unstake + restake cycle to
    // trigger the gauge's reward accounting update, which releases AERO to the adapter/executor.
    const executorAddress = chain.contracts.panoramaExecutor;
    const executorIface = new ethers.Interface(PANORAMA_EXECUTOR_ABI);
    const protocolId = encodeProtocolId("aerodrome");
    const unstakeExtra = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [gaugeAddress]);
    const stakeExtra = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [gaugeAddress]);

    const adapterStaked = await getStakedBalance(gaugeAddress, adapterAddress).catch(() => 0n);

    if (adapterStaked > 0n) {
      // Step 1: Unstake all LP from gauge (triggers reward accounting)
      steps.push({
        to: executorAddress,
        data: executorIface.encodeFunctionData("executeUnstake", [
          protocolId, poolAddress, adapterStaked, unstakeExtra,
        ]),
        value: "0",
        chainId: chain.chainId,
        description: `Unstake LP to claim ${poolConfig.rewardToken.symbol} rewards`,
      });

      // Step 2: Re-stake LP back into gauge
      steps.push({
        to: executorAddress,
        data: executorIface.encodeFunctionData("executeStake", [
          protocolId, poolAddress, adapterStaked, stakeExtra,
        ]),
        value: "0",
        chainId: chain.chainId,
        description: `Re-stake LP in ${poolConfig.name} gauge`,
      });
    }
  }

  if (userEarned > 0n) {
    // User has direct rewards — call gauge.getReward directly
    const gaugeIface = new ethers.Interface(GAUGE_ABI);
    steps.push({
      to: gaugeAddress,
      data: gaugeIface.encodeFunctionData("getReward", [req.userAddress]),
      value: "0",
      chainId: chain.chainId,
      description: `Claim ${poolConfig.rewardToken.symbol} rewards from gauge`,
    });
  }

  if (steps.length === 0) {
    // Adapter has rewards but no staked LP — can't do unstake+restake trick.
    // Rewards will be automatically claimed on the next stake or unstake operation.
    if (adapterEarned > 0n) {
      throw new Error(
        `Rewards exist but cannot be claimed separately right now (no staked LP). ` +
        `They will be automatically collected on your next stake operation.`
      );
    }
    throw new Error(`Unable to prepare claim for ${poolConfig.name}`);
  }

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
