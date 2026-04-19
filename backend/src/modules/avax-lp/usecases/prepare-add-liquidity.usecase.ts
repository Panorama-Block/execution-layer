import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { avaxService } from "../../../shared/services/avax.service";
import { avaxLpService } from "../../../shared/services/avax-lp.service";
import { applySlippage, getDeadline, encodeProtocolId } from "../../../utils/encoding";
import { BundleBuilder, TRADERJOE_LP_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { logger } from "../../../shared/logger";
import { getPoolByPair } from "../config/avax-lp-pools";

export interface PrepareAddLiquidityRequest {
  userAddress:     string;
  tokenA:          string;
  tokenB:          string;
  amountADesired:  string; // wei / base units
  amountBDesired:  string; // wei / base units
  slippageBps?:    number; // default 50 (0.5%)
}

export interface PrepareAddLiquidityResponse {
  bundle:   TransactionBundle;
  metadata: {
    action:         "addLiquidity";
    poolId:         string;
    tokenA:         string;
    tokenB:         string;
    symbolA:        string;
    symbolB:        string;
    pairAddress:    string;
    amountADesired: string;
    amountBDesired: string;
    amountAMin:     string;
    amountBMin:     string;
  };
}

export async function executePrepareAddLiquidity(
  req: PrepareAddLiquidityRequest
): Promise<PrepareAddLiquidityResponse> {
  logger.info({ chain: "avalanche", protocol: "traderjoe-lp", action: "addLiquidity", user: req.userAddress }, "Prepare addLiquidity request");

  const chain        = getChainConfig("avalanche");
  const executorAddr = chain.contracts.panoramaExecutor;
  if (!executorAddr) throw new AppError("INTERNAL_ERROR", "PanoramaExecutor not deployed on Avalanche");

  const pool = getPoolByPair(req.tokenA, req.tokenB);
  if (!pool) throw new AppError("POOL_NOT_FOUND", `LP pool not found for pair: ${req.tokenA}/${req.tokenB}`);

  const amountA = BigInt(req.amountADesired);
  const amountB = BigInt(req.amountBDesired);
  if (amountA === 0n || amountB === 0n) throw new AppError("INVALID_AMOUNT", "amounts must be positive");

  const slip     = req.slippageBps ?? 50;
  const amountAMin = applySlippage(amountA, slip);
  const amountBMin = applySlippage(amountB, slip);
  const deadline   = getDeadline(5);

  const protocolId = encodeProtocolId("traderjoe");
  const builder    = new BundleBuilder(chain.chainId);

  // Approve tokenA → executor (if ERC-20 allowance insufficient)
  const allowanceA = await avaxService.checkAllowance(req.tokenA, req.userAddress, executorAddr, amountA);
  builder.addApproveIfNeeded(req.tokenA, executorAddr, allowanceA, amountA, `Approve ${pool.tokenA.symbol} for TraderJoe LP`);

  // Approve tokenB → executor
  const allowanceB = await avaxService.checkAllowance(req.tokenB, req.userAddress, executorAddr, amountB);
  builder.addApproveIfNeeded(req.tokenB, executorAddr, allowanceB, amountB, `Approve ${pool.tokenB.symbol} for TraderJoe LP`);

  const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint256", "uint256", "uint256", "uint256", "address"],
    [req.tokenA, req.tokenB, amountA, amountB, amountAMin, amountBMin, req.userAddress]
  );

  builder.addExecute(
    protocolId,
    TRADERJOE_LP_SELECTORS.ADD_LIQUIDITY,
    [
      { token: req.tokenA, amount: amountA },
      { token: req.tokenB, amount: amountB },
    ],
    deadline,
    adapterData,
    0n,
    executorAddr,
    `Add ${pool.tokenA.symbol}/${pool.tokenB.symbol} liquidity on TraderJoe`
  );

  const bundle = await builder.buildWithGas(
    `Add ${pool.tokenA.symbol}/${pool.tokenB.symbol} liquidity on TraderJoe V1`,
    req.userAddress
  );

  logger.info({ chain: "avalanche", protocol: "traderjoe-lp", pool: pool.id, steps: bundle.totalSteps }, "addLiquidity bundle built");

  return {
    bundle,
    metadata: {
      action:         "addLiquidity",
      poolId:         pool.id,
      tokenA:         req.tokenA,
      tokenB:         req.tokenB,
      symbolA:        pool.tokenA.symbol,
      symbolB:        pool.tokenB.symbol,
      pairAddress:    pool.pairAddress,
      amountADesired: amountA.toString(),
      amountBDesired: amountB.toString(),
      amountAMin:     amountAMin.toString(),
      amountBMin:     amountBMin.toString(),
    },
  };
}
