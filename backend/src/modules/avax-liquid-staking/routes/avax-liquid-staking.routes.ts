import { Router } from "express";
import { validateAddress, validateAmount, validateRequired } from "../../../middleware/validation";
import { executionTimeout } from "../../../middleware/execution-timeout";
import * as ctrl from "../controllers/avax-liquid-staking.controller";

export const avaxLiquidStakingRoutes = Router();

/**
 * GET /avax/liquid-staking/position/:userAddress
 * Returns the user's pending unlock requests and current exchange rate.
 */
avaxLiquidStakingRoutes.get(
  "/position/:userAddress",
  validateAddress("userAddress", "params"),
  ctrl.getPosition
);

/**
 * POST /avax/liquid-staking/prepare-stake
 * Prepares a TransactionBundle to stake AVAX → sAVAX via BENQI.
 * Steps: [stake() with AVAX value]
 *
 * Body: { userAddress, amount } — amount in wei
 */
avaxLiquidStakingRoutes.post(
  "/prepare-stake",
  validateRequired("userAddress", "amount"),
  validateAddress("userAddress"),
  validateAmount("amount"),
  executionTimeout(),
  ctrl.prepareStake
);

/**
 * POST /avax/liquid-staking/prepare-request-unlock
 * Prepares a TransactionBundle to request unlock of sAVAX → AVAX (~15 day cooldown).
 * Steps: [approve sAVAX] + [requestUnlock(sAvaxAmount)]
 *
 * Body: { userAddress, sAvaxAmount } — sAvaxAmount in wei
 */
avaxLiquidStakingRoutes.post(
  "/prepare-request-unlock",
  validateRequired("userAddress", "sAvaxAmount"),
  validateAddress("userAddress"),
  validateAmount("sAvaxAmount"),
  executionTimeout(),
  ctrl.prepareRequestUnlock
);

/**
 * POST /avax/liquid-staking/prepare-redeem
 * Prepares a TransactionBundle to redeem AVAX after cooldown.
 * Steps: [redeem(userUnlockIndex)]
 *
 * Body: { userAddress, userUnlockIndex } — index from getPosition or requestUnlock response
 */
avaxLiquidStakingRoutes.post(
  "/prepare-redeem",
  validateRequired("userAddress", "userUnlockIndex"),
  validateAddress("userAddress"),
  executionTimeout(),
  ctrl.prepareRedeem
);
