import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { avaxLpService } from "../../../shared/services/avax-lp.service";
import { getDeadline, encodeProtocolId } from "../../../utils/encoding";
import { BundleBuilder, TRADERJOE_LP_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { logger } from "../../../shared/logger";
import { getPoolById } from "../config/avax-lp-pools";

export interface PrepareUnstakeRequest {
  userAddress:  string;
  poolId:       string;
  lpAmount:     string; // LP amount to withdraw; pass "0" to withdraw all
  proxyAddress: string; // user's BeaconProxy address for the traderjoe protocol
}

export interface PrepareUnstakeResponse {
  bundle:   TransactionBundle;
  metadata: {
    action:      "unstake";
    poolId:      string;
    pairAddress: string;
    farmPid:     number;
    lpAmount:    string;
    stakedAmount: string;
  };
}

export async function executePrepareUnstake(req: PrepareUnstakeRequest): Promise<PrepareUnstakeResponse> {
  logger.info({ chain: "avalanche", protocol: "traderjoe-lp", action: "unstake", user: req.userAddress, poolId: req.poolId }, "Prepare unstake request");

  const chain        = getChainConfig("avalanche");
  const executorAddr = chain.contracts.panoramaExecutor;
  if (!executorAddr) throw new AppError("INTERNAL_ERROR", "PanoramaExecutor not deployed on Avalanche");

  const pool = getPoolById(req.poolId);
  if (!pool) throw new AppError("POOL_NOT_FOUND", `Pool not found: ${req.poolId}`);
  if (pool.farmPid === null) throw new AppError("UNSUPPORTED_OPERATION", `Pool ${req.poolId} has no active farm`);

  // Check staked balance in farm via proxy
  const farmInfo = await avaxLpService.getUserFarmInfo(pool.farmPid, req.proxyAddress);
  if (farmInfo.amount === 0n) throw new AppError("NO_LP_POSITION", "No staked LP tokens found in farm");

  const requestedAmount = BigInt(req.lpAmount);
  const lpAmount = requestedAmount === 0n ? farmInfo.amount : requestedAmount;

  if (lpAmount > farmInfo.amount) {
    throw new AppError("INSUFFICIENT_LP_BALANCE", `Staked: ${farmInfo.amount}, requested: ${lpAmount}`);
  }

  const deadline   = getDeadline(5);
  const protocolId = encodeProtocolId("traderjoe");
  const builder    = new BundleBuilder(chain.chainId);

  // No approve needed — proxy already holds the staked LP in MasterChef
  // unstake(pid, amount, lpToken, recipient)
  const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint256", "address", "address"],
    [pool.farmPid, lpAmount, pool.pairAddress, req.userAddress]
  );

  // No ERC-20 transfer from user — executor calls proxy directly
  builder.addExecute(
    protocolId,
    TRADERJOE_LP_SELECTORS.UNSTAKE,
    [],
    deadline,
    adapterData,
    0n,
    executorAddr,
    `Unstake ${pool.tokenA.symbol}/${pool.tokenB.symbol} LP from TraderJoe farm`
  );

  const bundle = await builder.buildWithGas(
    `Unstake ${pool.tokenA.symbol}/${pool.tokenB.symbol} LP on TraderJoe Farm`,
    req.userAddress
  );

  logger.info({ chain: "avalanche", protocol: "traderjoe-lp", pool: pool.id, pid: pool.farmPid, lpAmount: lpAmount.toString(), steps: bundle.totalSteps }, "unstake bundle built");

  return {
    bundle,
    metadata: {
      action:       "unstake",
      poolId:       pool.id,
      pairAddress:  pool.pairAddress,
      farmPid:      pool.farmPid,
      lpAmount:     lpAmount.toString(),
      stakedAmount: farmInfo.amount.toString(),
    },
  };
}
