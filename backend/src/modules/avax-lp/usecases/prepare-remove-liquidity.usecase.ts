import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { avaxLpService } from "../../../shared/services/avax-lp.service";
import { getDeadline, encodeProtocolId } from "../../../utils/encoding";
import { BundleBuilder, TRADERJOE_LP_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { logger } from "../../../shared/logger";
import { getPoolByPair } from "../config/avax-lp-pools";

export interface PrepareRemoveLiquidityRequest {
  userAddress:  string;
  tokenA:       string;
  tokenB:       string;
  lpAmount:     string; // LP token amount in wei
  amountAMin?:  string; // minimum tokenA to receive (defaults to 0 — caller should set)
  amountBMin?:  string; // minimum tokenB to receive
}

export interface PrepareRemoveLiquidityResponse {
  bundle:   TransactionBundle;
  metadata: {
    action:       "removeLiquidity";
    poolId:       string;
    tokenA:       string;
    tokenB:       string;
    symbolA:      string;
    symbolB:      string;
    pairAddress:  string;
    lpAmount:     string;
    amountAMin:   string;
    amountBMin:   string;
  };
}

export async function executePrepareRemoveLiquidity(
  req: PrepareRemoveLiquidityRequest
): Promise<PrepareRemoveLiquidityResponse> {
  logger.info({ chain: "avalanche", protocol: "traderjoe-lp", action: "removeLiquidity", user: req.userAddress }, "Prepare removeLiquidity request");

  const chain        = getChainConfig("avalanche");
  const executorAddr = chain.contracts.panoramaExecutor;
  if (!executorAddr) throw new AppError("INTERNAL_ERROR", "PanoramaExecutor not deployed on Avalanche");

  const pool = getPoolByPair(req.tokenA, req.tokenB);
  if (!pool) throw new AppError("POOL_NOT_FOUND", `LP pool not found for pair: ${req.tokenA}/${req.tokenB}`);

  const lpAmount   = BigInt(req.lpAmount);
  if (lpAmount === 0n) throw new AppError("INVALID_AMOUNT", "lpAmount must be positive");

  // Verify user has sufficient LP balance
  const lpBalance = await avaxLpService.getLpBalance(pool.pairAddress, req.userAddress);
  if (lpBalance < lpAmount) throw new AppError("INSUFFICIENT_LP_BALANCE", `Need ${lpAmount}, have ${lpBalance}`);

  const amountAMin = BigInt(req.amountAMin ?? "0");
  const amountBMin = BigInt(req.amountBMin ?? "0");
  const deadline   = getDeadline(5);
  const protocolId = encodeProtocolId("traderjoe");
  const builder    = new BundleBuilder(chain.chainId);

  // Approve LP token → executor so it can pull it into the proxy
  const lpAllowance = await avaxLpService.checkLpAllowance(pool.pairAddress, req.userAddress, executorAddr);
  builder.addApproveIfNeeded(
    pool.pairAddress,
    executorAddr,
    lpAllowance,
    lpAmount,
    `Approve ${pool.tokenA.symbol}/${pool.tokenB.symbol} LP for TraderJoe`
  );

  const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address", "uint256", "uint256", "uint256", "address"],
    [req.tokenA, req.tokenB, pool.pairAddress, lpAmount, amountAMin, amountBMin, req.userAddress]
  );

  builder.addExecute(
    protocolId,
    TRADERJOE_LP_SELECTORS.REMOVE_LIQUIDITY,
    [{ token: pool.pairAddress, amount: lpAmount }],
    deadline,
    adapterData,
    0n,
    executorAddr,
    `Remove ${pool.tokenA.symbol}/${pool.tokenB.symbol} liquidity from TraderJoe`
  );

  const bundle = await builder.buildWithGas(
    `Remove ${pool.tokenA.symbol}/${pool.tokenB.symbol} liquidity on TraderJoe V1`,
    req.userAddress
  );

  logger.info({ chain: "avalanche", protocol: "traderjoe-lp", pool: pool.id, steps: bundle.totalSteps }, "removeLiquidity bundle built");

  return {
    bundle,
    metadata: {
      action:      "removeLiquidity",
      poolId:      pool.id,
      tokenA:      req.tokenA,
      tokenB:      req.tokenB,
      symbolA:     pool.tokenA.symbol,
      symbolB:     pool.tokenB.symbol,
      pairAddress: pool.pairAddress,
      lpAmount:    lpAmount.toString(),
      amountAMin:  amountAMin.toString(),
      amountBMin:  amountBMin.toString(),
    },
  };
}
