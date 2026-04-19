import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { avaxLpService } from "../../../shared/services/avax-lp.service";
import { getDeadline, encodeProtocolId } from "../../../utils/encoding";
import { BundleBuilder, TRADERJOE_LP_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { logger } from "../../../shared/logger";
import { getPoolById } from "../config/avax-lp-pools";

export interface PrepareClaimRewardsRequest {
  userAddress:  string;
  poolId:       string;
  proxyAddress: string; // user's BeaconProxy address for the traderjoe protocol
}

export interface PrepareClaimRewardsResponse {
  bundle:         TransactionBundle;
  metadata: {
    action:        "claimRewards";
    poolId:        string;
    farmPid:       number;
    pendingJoe:    string;
  };
}

export async function executePrepareClaimRewards(
  req: PrepareClaimRewardsRequest
): Promise<PrepareClaimRewardsResponse> {
  logger.info({ chain: "avalanche", protocol: "traderjoe-lp", action: "claimRewards", user: req.userAddress, poolId: req.poolId }, "Prepare claimRewards request");

  const chain        = getChainConfig("avalanche");
  const executorAddr = chain.contracts.panoramaExecutor;
  if (!executorAddr) throw new AppError("INTERNAL_ERROR", "PanoramaExecutor not deployed on Avalanche");

  const pool = getPoolById(req.poolId);
  if (!pool) throw new AppError("POOL_NOT_FOUND", `Pool not found: ${req.poolId}`);
  if (pool.farmPid === null) throw new AppError("UNSUPPORTED_OPERATION", `Pool ${req.poolId} has no active farm`);

  // Verify user has a staked position before building the bundle
  const farmInfo = await avaxLpService.getUserFarmInfo(pool.farmPid, req.proxyAddress);
  if (farmInfo.amount === 0n) throw new AppError("NO_LP_POSITION", "No staked LP tokens — nothing to harvest");

  // Informational: fetch pending rewards (non-blocking — we proceed even if 0)
  const pendingJoe = await avaxLpService.getPendingRewards(pool.farmPid, req.proxyAddress);

  const deadline   = getDeadline(5);
  const protocolId = encodeProtocolId("traderjoe");
  const builder    = new BundleBuilder(chain.chainId);

  // claimRewards(pid, recipient) — no ERC-20 transfer needed
  const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address"],
    [pool.farmPid, req.userAddress]
  );

  builder.addExecute(
    protocolId,
    TRADERJOE_LP_SELECTORS.CLAIM_REWARDS,
    [],
    deadline,
    adapterData,
    0n,
    executorAddr,
    `Harvest JOE rewards from ${pool.tokenA.symbol}/${pool.tokenB.symbol} farm`
  );

  const bundle = await builder.buildWithGas(
    `Claim JOE rewards from TraderJoe ${pool.tokenA.symbol}/${pool.tokenB.symbol} farm`,
    req.userAddress
  );

  logger.info({ chain: "avalanche", protocol: "traderjoe-lp", pool: pool.id, pid: pool.farmPid, pendingJoe: pendingJoe.toString(), steps: bundle.totalSteps }, "claimRewards bundle built");

  return {
    bundle,
    metadata: {
      action:     "claimRewards",
      poolId:     pool.id,
      farmPid:    pool.farmPid,
      pendingJoe: pendingJoe.toString(),
    },
  };
}
