import { Router } from "express";
import { validateAddress, validateAmount, validateSlippage, validateRequired } from "../../../middleware/validation";
import * as ctrl from "../controllers/avax-swap.controller";

export const avaxSwapRoutes = Router();

/**
 * GET /avax/swap/pairs
 * Returns supported swap pairs on Avalanche C-Chain.
 */
avaxSwapRoutes.get("/pairs", ctrl.getPairs);

/**
 * POST /avax/swap/quote
 * Returns a price quote for a swap without preparing the transaction.
 *
 * Body: { tokenIn, tokenOut, amountIn, slippageBps? }
 */
avaxSwapRoutes.post(
  "/quote",
  validateRequired("tokenIn", "tokenOut", "amountIn"),
  validateAddress("tokenIn"),
  validateAddress("tokenOut"),
  validateAmount("amountIn"),
  validateSlippage(),
  ctrl.getQuote
);

/**
 * POST /avax/swap/prepare
 * Prepares a TransactionBundle for the caller to sign and broadcast.
 * Returns: approve step (if needed) + swap step.
 *
 * Body: { userAddress, tokenIn, tokenOut, amountIn, slippageBps?, deadlineMinutes? }
 */
avaxSwapRoutes.post(
  "/prepare",
  validateRequired("userAddress", "tokenIn", "tokenOut", "amountIn"),
  validateAddress("userAddress"),
  validateAddress("tokenIn"),
  validateAddress("tokenOut"),
  validateAmount("amountIn"),
  validateSlippage(),
  ctrl.prepareSwap
);
