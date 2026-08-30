import { Router } from "express";
import { validateAddress, validateAmount, validateRequired } from "../../../middleware/validation";
import { executionTimeout } from "../../../middleware/execution-timeout";
import * as ctrl from "../controllers/avax-lending.controller";

export const avaxLendingRoutes = Router();

/**
 * GET /avax/lending/markets
 * Returns all available Benqi markets with live supply/borrow rates.
 */
avaxLendingRoutes.get("/markets", ctrl.getMarkets);

/**
 * GET /avax/lending/position/:userAddress
 * Returns the user's active qToken balances across all markets.
 */
avaxLendingRoutes.get(
  "/position/:userAddress",
  validateAddress("userAddress", "params"),
  ctrl.getUserPosition
);

/**
 * POST /avax/lending/prepare-supply
 * Prepares a TransactionBundle to supply assets to Benqi.
 * Steps: [approve (if ERC20 + needed)] + [supply / supplyAVAX]
 *
 * Body: { userAddress, qTokenAddress, amount }
 */
avaxLendingRoutes.post(
  "/prepare-supply",
  validateRequired("userAddress", "qTokenAddress", "amount"),
  validateAddress("userAddress"),
  validateAddress("qTokenAddress"),
  validateAmount("amount"),
  executionTimeout(),
  ctrl.prepareSupply
);

/**
 * POST /avax/lending/evidence/:correlationId/submissions
 * Records a submitted lending transaction and independently verifies
 * its Avalanche receipt against the prepared evidence commitment.
 *
 * Body: { stepIndex, txHash, executionMechanism?, providerMetadata? }
 */
avaxLendingRoutes.post(
  "/evidence/:correlationId/submissions",
  ctrl.submitEvidence
);

/**
 * POST /avax/lending/prepare-redeem
 * Prepares a TransactionBundle to redeem qTokens for underlying.
 * Steps: [approve qToken] + [redeem / redeemAVAX]
 *
 * Body: { userAddress, qTokenAddress, amount }
 * amount is the requested underlying amount in underlying base units.
 */
avaxLendingRoutes.post(
  "/prepare-redeem",
  validateRequired("userAddress", "qTokenAddress", "amount"),
  validateAddress("userAddress"),
  validateAddress("qTokenAddress"),
  validateAmount("amount"),
  executionTimeout(),
  ctrl.prepareRedeem
);

/**
 * POST /avax/lending/prepare-borrow
 * Prepares a TransactionBundle to borrow from Benqi.
 * Steps: [borrow / borrowAVAX]
 * Note: user must have collateral supplied via PanoramaLend first.
 *
 * Body: { userAddress, qTokenAddress, amount }
 */
avaxLendingRoutes.post(
  "/prepare-borrow",
  validateRequired("userAddress", "qTokenAddress", "amount"),
  validateAddress("userAddress"),
  validateAddress("qTokenAddress"),
  validateAmount("amount"),
  executionTimeout(),
  ctrl.prepareBorrow
);

/**
 * POST /avax/lending/prepare-repay
 * Prepares a TransactionBundle to repay a Benqi borrow.
 * Steps: [approve (if ERC20 + needed)] + [repay / repayAVAX]
 *
 * Body: { userAddress, qTokenAddress, amount }
 */
avaxLendingRoutes.post(
  "/prepare-repay",
  validateRequired("userAddress", "qTokenAddress", "amount"),
  validateAddress("userAddress"),
  validateAddress("qTokenAddress"),
  validateAmount("amount"),
  executionTimeout(),
  ctrl.prepareRepay
);
