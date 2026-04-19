import { Router } from "express";
import { validateAddress, validateAmount, validateRequired } from "../../../middleware/validation";
import { executionTimeout } from "../../../middleware/execution-timeout";
import * as ctrl from "../controllers/metronome.controller";

export const metronomeRoutes = Router();

/**
 * GET /modules/metronome/markets
 * Returns the catalog of Metronome Synth markets available on Base:
 *   - collateral markets (DepositToken wrappers: msdUSDC, msdWETH, ...)
 *   - synthetic markets  (DebtToken + synth: msUSD, msETH, ...)
 */
metronomeRoutes.get("/markets", ctrl.getMarkets);

/**
 * GET /modules/metronome/position/:userAddress
 * Reads collateral shares + synthetic debt held by the user's deterministic
 * Metronome adapter proxy on Base. Returns zeros if the proxy is not yet
 * predictable (protocol not registered on executor).
 */
metronomeRoutes.get(
  "/position/:userAddress",
  validateAddress("userAddress", "params"),
  ctrl.getUserPosition
);

/**
 * POST /modules/metronome/prepare-deposit
 * Steps: [approve underlying (if needed)] + [executor.execute -> depositCollateral]
 * Body: { userAddress, depositTokenAddress, amount }
 */
metronomeRoutes.post(
  "/prepare-deposit",
  validateRequired("userAddress", "depositTokenAddress", "amount"),
  validateAddress("userAddress"),
  validateAddress("depositTokenAddress"),
  validateAmount("amount"),
  executionTimeout(),
  ctrl.prepareDeposit
);

/**
 * POST /modules/metronome/prepare-withdraw
 * Steps: [executor.execute -> withdrawCollateral(depositToken, amount, recipient)]
 * No approve needed — collateral shares already live on the per-user proxy.
 * Body: { userAddress, depositTokenAddress, amount, recipient? }
 */
metronomeRoutes.post(
  "/prepare-withdraw",
  validateRequired("userAddress", "depositTokenAddress", "amount"),
  validateAddress("userAddress"),
  validateAddress("depositTokenAddress"),
  validateAmount("amount"),
  executionTimeout(),
  ctrl.prepareWithdraw
);

/**
 * POST /modules/metronome/prepare-mint
 * Steps: [executor.execute -> mintSynth(debtToken, amount, recipient)]
 * No approve needed — draws against collateral already held by the proxy.
 * Body: { userAddress, debtTokenAddress, amount, recipient? }
 */
metronomeRoutes.post(
  "/prepare-mint",
  validateRequired("userAddress", "debtTokenAddress", "amount"),
  validateAddress("userAddress"),
  validateAddress("debtTokenAddress"),
  validateAmount("amount"),
  executionTimeout(),
  ctrl.prepareMint
);

/**
 * POST /modules/metronome/prepare-repay
 * Steps: [approve synth (if needed)] + [executor.execute -> repaySynth(debtToken, amount)]
 * Body: { userAddress, debtTokenAddress, amount }
 */
metronomeRoutes.post(
  "/prepare-repay",
  validateRequired("userAddress", "debtTokenAddress", "amount"),
  validateAddress("userAddress"),
  validateAddress("debtTokenAddress"),
  validateAmount("amount"),
  executionTimeout(),
  ctrl.prepareRepay
);

/**
 * POST /modules/metronome/prepare-unwind
 * Closes a position atomically: repayAll + withdraw all collateral.
 * Steps: [approve synth (if needed)] + [executor.execute -> unwind(debtToken, depositToken, recipient)]
 * `synthAmount` must cover the full outstanding debt plus protocol fee.
 * Body: { userAddress, debtTokenAddress, depositTokenAddress, synthAmount, recipient? }
 */
metronomeRoutes.post(
  "/prepare-unwind",
  validateRequired("userAddress", "debtTokenAddress", "depositTokenAddress", "synthAmount"),
  validateAddress("userAddress"),
  validateAddress("debtTokenAddress"),
  validateAddress("depositTokenAddress"),
  validateAmount("synthAmount"),
  executionTimeout(),
  ctrl.prepareUnwind
);
