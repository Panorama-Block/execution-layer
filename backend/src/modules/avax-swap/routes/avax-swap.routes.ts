import { Router } from "express";
import { validateAddress, validateAmount, validateSlippage, validateRequired } from "../../../middleware/validation";
import { executionTimeout } from "../../../middleware/execution-timeout";
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
  executionTimeout(),
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
  executionTimeout(),
  ctrl.prepareSwap
);

/**
 * POST /avax/swap/evidence/:correlationId/submissions
 * Records a client-broadcast transaction hash and independently verifies
 * the transaction/receipt through the backend's read-only Avalanche RPC.
 *
 * Body: {
 *   stepIndex,
 *   txHash,
 *   executionMechanism?,
 *   providerMetadata?
 * }
 */
avaxSwapRoutes.post(
  "/evidence/:correlationId/submissions",
  validateRequired("stepIndex", "txHash"),
  executionTimeout(),
  ctrl.submitEvidence
);

/**
 * GET /avax/swap/evidence/:correlationId
 * Returns the complete durable evidence chain from the DB.
 */
avaxSwapRoutes.get(
  "/evidence/:correlationId",
  executionTimeout(),
  ctrl.getEvidence
);

/**
 * GET /avax/swap/evidence/:correlationId/export
 * Returns deterministic sanitised DB-derived JSON suitable
 * for independent verification and archival.
 */
avaxSwapRoutes.get(
  "/evidence/:correlationId/export",
  executionTimeout(),
  ctrl.exportEvidence
);

