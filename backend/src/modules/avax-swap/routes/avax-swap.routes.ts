import { Router } from "express";
import { validateAddress, validateAmount, validateSlippage, validateRequired } from "../../../middleware/validation";
import { requireWalletAuth } from "../../../middleware/auth";
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
 * POST /avax/swap/bridge/evidence/intent
 *
 * T1 boundary for client-prepared Avalanche bridge operations.
 * Persists the source-chain intent before Thirdweb/LayerSwap
 * transaction preparation occurs.
 *
 * Body: {
 *   userAddress,
 *   destinationChainId,
 *   sourceToken,
 *   destinationToken?,
 *   amountRaw
 * }
 */
avaxSwapRoutes.post(
  "/bridge/evidence/intent",
  validateRequired(
    "userAddress",
    "destinationChainId",
    "sourceToken",
    "amountRaw"
  ),
  validateAddress("userAddress"),
  validateAddress("sourceToken"),
  executionTimeout(),
  ctrl.beginBridgeEvidence
);

/**
 * POST /avax/swap/bridge/evidence/:correlationId/prepare
 *
 * T3 boundary for client-prepared Avalanche bridge operations.
 * Commits the exact ordered source transaction bundle after provider
 * preparation and before the first wallet signature.
 *
 * Body: {
 *   destinationChainId,
 *   provider,
 *   steps
 * }
 */
avaxSwapRoutes.post(
  "/bridge/evidence/:correlationId/prepare",
  validateRequired(
    "destinationChainId",
    "provider",
    "steps"
  ),
  executionTimeout(),
  ctrl.commitBridgeEvidence
);

/**
 * POST /avax/swap/bridge/destination/evidence/intent
 *
 * T1 boundary for Avalanche destination execution prepared
 * client-side by a cross-chain provider.
 */
avaxSwapRoutes.post(
  "/bridge/destination/evidence/intent",
  validateRequired(
    "userAddress",
    "sourceChainId",
    "destinationToken",
    "amountRaw"
  ),
  validateAddress("userAddress"),
  validateAddress("destinationToken"),
  executionTimeout(),
  ctrl.beginBridgeDestinationEvidence
);

/**
 * POST /avax/swap/bridge/destination/evidence/:correlationId/prepare
 *
 * Commits the exact ordered Avalanche destination suffix before
 * PanoramaBlock signs any destination-chain transaction.
 */
avaxSwapRoutes.post(
  "/bridge/destination/evidence/:correlationId/prepare",
  validateRequired(
    "sourceChainId",
    "provider",
    "steps"
  ),
  executionTimeout(),
  ctrl.commitBridgeDestinationEvidence
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
 * POST /avax/swap/evidence/:correlationId/verifications
 * Independently re-verifies the persisted submitted transaction.
 *
 * Body: { stepIndex }
 *
 * txHash is deliberately not accepted. Verification is bound to
 * the immutable transaction hash already persisted for the step.
 */
avaxSwapRoutes.post(
  "/evidence/:correlationId/verifications",
  validateRequired("stepIndex"),
  executionTimeout(),
  ctrl.verifyEvidence
);

/**
 * GET /avax/swap/evidence/export/:userAddress
 * Returns a wallet-scoped bulk evidence export.
 * Requires wallet signature authentication.
 */
avaxSwapRoutes.get(
  "/evidence/export/:userAddress",
  validateAddress("userAddress", "params"),
  requireWalletAuth,
  executionTimeout(),
  ctrl.exportEvidenceByWallet
);

/**
 * GET /avax/swap/evidence/admin/status/:userAddress
 * Returns whether the authenticated wallet has Phase 2 admin capability.
 * Requires wallet signature authentication.
 */
avaxSwapRoutes.get(
  "/evidence/admin/status/:userAddress",
  validateAddress("userAddress", "params"),
  requireWalletAuth,
  executionTimeout(),
  ctrl.getEvidenceAdminStatus
);

/**
 * GET /avax/swap/evidence/admin/export/:userAddress
 * Returns an admin-wide Avalanche evidence export.
 * Requires wallet signature authentication and Phase 2 admin allowlist membership.
 */
avaxSwapRoutes.get(
  "/evidence/admin/export/:userAddress",
  validateAddress("userAddress", "params"),
  requireWalletAuth,
  executionTimeout(),
  ctrl.exportEvidenceAdmin
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

