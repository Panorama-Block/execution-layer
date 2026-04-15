import { Router } from "express";
import { validateAddress, validateAmount, validateRequired } from "../../../middleware/validation";
import { executionTimeout } from "../../../middleware/execution-timeout";
import * as ctrl from "../controllers/moonwell-lending.controller";

export const moonwellLendingRoutes = Router();

/**
 * GET /base/lending/markets
 * Returns all available Moonwell markets with live supply/borrow rates.
 */
moonwellLendingRoutes.get("/markets", ctrl.getMarkets);

/**
 * GET /base/lending/position/:userAddress
 * Returns the user's active mToken balances across all Moonwell markets.
 */
moonwellLendingRoutes.get(
  "/position/:userAddress",
  validateAddress("userAddress", "params"),
  ctrl.getUserPosition
);

/**
 * POST /base/lending/prepare-supply
 * Prepares a TransactionBundle to supply assets to Moonwell.
 * Steps: [approve (ERC20 + if needed)] + [supply / supplyETH]
 *
 * Body: { userAddress, mTokenAddress, amount, useNativeETH? }
 */
moonwellLendingRoutes.post(
  "/prepare-supply",
  validateRequired("userAddress", "mTokenAddress", "amount"),
  validateAddress("userAddress"),
  validateAddress("mTokenAddress"),
  validateAmount("amount"),
  executionTimeout(),
  ctrl.prepareSupply
);

/**
 * POST /base/lending/prepare-redeem
 * Prepares a TransactionBundle to redeem mTokens for underlying.
 * Steps: [approve mToken] + [redeem / redeemETH]
 *
 * Body: { userAddress, mTokenAddress, amount, useNativeETH? }
 */
moonwellLendingRoutes.post(
  "/prepare-redeem",
  validateRequired("userAddress", "mTokenAddress", "amount"),
  validateAddress("userAddress"),
  validateAddress("mTokenAddress"),
  validateAmount("amount"),
  executionTimeout(),
  ctrl.prepareRedeem
);

/**
 * POST /base/lending/prepare-borrow
 * Prepares a TransactionBundle to borrow from Moonwell.
 * Steps: [borrow / borrowETH]
 * Note: user must have collateral supplied and markets entered first.
 *
 * Body: { userAddress, mTokenAddress, amount, useNativeETH? }
 */
moonwellLendingRoutes.post(
  "/prepare-borrow",
  validateRequired("userAddress", "mTokenAddress", "amount"),
  validateAddress("userAddress"),
  validateAddress("mTokenAddress"),
  validateAmount("amount"),
  executionTimeout(),
  ctrl.prepareBorrow
);

/**
 * POST /base/lending/prepare-repay
 * Prepares a TransactionBundle to repay a Moonwell borrow.
 * Steps: [approve (ERC20 + if needed)] + [repay / repayETH]
 *
 * Body: { userAddress, mTokenAddress, amount, useNativeETH? }
 */
moonwellLendingRoutes.post(
  "/prepare-repay",
  validateRequired("userAddress", "mTokenAddress", "amount"),
  validateAddress("userAddress"),
  validateAddress("mTokenAddress"),
  validateAmount("amount"),
  executionTimeout(),
  ctrl.prepareRepay
);
