import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { getStakingPoolById } from "../config/staking-pools";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { TransactionBundle } from "../../../types/transaction";
import { aerodromeService } from "../../../shared/services/aerodrome.service";
import { BundleBuilder, ADAPTER_SELECTORS } from "../../../shared/bundle-builder";

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
  const { poolAddress, gaugeAddress } = await aerodromeService.resolvePoolAndGauge(poolConfig);

  // Get user's adapter clone address and check earned rewards
  const userAdapter = await aerodromeService.getUserAdapterAddress(req.userAddress, "aerodrome");
  const earnedRewards = userAdapter
    ? await aerodromeService.getEarnedRewards(gaugeAddress, userAdapter).catch(() => 0n)
    : 0n;

  if (earnedRewards === 0n) {
    throw new Error(`No rewards to claim for ${poolConfig.name}`);
  }

  const protocolId = encodeProtocolId("aerodrome");
  const deadline   = getDeadline(20);
  const claimData  = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address"],
    [poolAddress, req.userAddress, gaugeAddress]
  );

  const builder = new BundleBuilder(chain.chainId);
  builder.addExecute(
    protocolId, ADAPTER_SELECTORS.CLAIM_REWARDS,
    [], deadline, claimData, 0n,
    chain.contracts.panoramaExecutor,
    `Claim ${poolConfig.rewardToken.symbol} rewards from ${poolConfig.name}`
  );

  return {
    bundle: builder.build(`Claim rewards from ${poolConfig.name}`),
    metadata: {
      poolId: poolConfig.id,
      gaugeAddress,
      earnedRewards: earnedRewards.toString(),
      rewardToken: poolConfig.rewardToken,
    },
  };
}
