import { Router } from "express";
import {
  validateAddress,
  validateAmount,
  validateRequired,
  validateSlippage,
} from "../../../middleware/validation";
import { executionTimeout } from "../../../middleware/execution-timeout";
import * as ctrl from "../controllers/avax-lp.controller";

export const avaxLpRoutes = Router();

/**
 * GET /avax/lp/pools
 * Returns all enabled TraderJoe V1 LP pools with farm metadata.
 */
avaxLpRoutes.get("/pools", ctrl.getPools);

/**
 * GET /avax/lp/position/:userAddress?proxyAddress=0x...
 * Returns user's LP balances and staked farm positions.
 * Optionally pass proxyAddress to fetch on-chain farm data.
 */
avaxLpRoutes.get(
  "/position/:userAddress",
  validateAddress("userAddress", "params"),
  ctrl.getUserPosition
);

/**
 * POST /avax/lp/prepare-add-liquidity
 * Builds a TransactionBundle to add Token-Token liquidity on TraderJoe V1.
 *
 * Body: { userAddress, tokenA, tokenB, amountADesired, amountBDesired, slippageBps? }
 * Returns: [approve tokenA?] + [approve tokenB?] + [addLiquidity via executor]
 */
avaxLpRoutes.post(
  "/prepare-add-liquidity",
  validateRequired("userAddress", "tokenA", "tokenB", "amountADesired", "amountBDesired"),
  validateAddress("userAddress"),
  validateAddress("tokenA"),
  validateAddress("tokenB"),
  validateAmount("amountADesired"),
  validateAmount("amountBDesired"),
  validateSlippage(),
  executionTimeout(),
  ctrl.prepareAddLiquidity
);

/**
 * POST /avax/lp/prepare-remove-liquidity
 * Builds a TransactionBundle to remove liquidity and receive underlying tokens.
 *
 * Body: { userAddress, tokenA, tokenB, lpAmount, amountAMin?, amountBMin? }
 * Returns: [approve LP token] + [removeLiquidity via executor]
 */
avaxLpRoutes.post(
  "/prepare-remove-liquidity",
  validateRequired("userAddress", "tokenA", "tokenB", "lpAmount"),
  validateAddress("userAddress"),
  validateAddress("tokenA"),
  validateAddress("tokenB"),
  validateAmount("lpAmount"),
  executionTimeout(),
  ctrl.prepareRemoveLiquidity
);

/**
 * POST /avax/lp/prepare-stake
 * Builds a TransactionBundle to stake LP tokens into a MasterChefJoeV3 farm.
 *
 * Body: { userAddress, poolId, lpAmount }
 * Returns: [approve LP token] + [stake via executor]
 */
avaxLpRoutes.post(
  "/prepare-stake",
  validateRequired("userAddress", "poolId", "lpAmount"),
  validateAddress("userAddress"),
  validateAmount("lpAmount"),
  executionTimeout(),
  ctrl.prepareStake
);

/**
 * POST /avax/lp/prepare-unstake
 * Builds a TransactionBundle to withdraw LP tokens from a MasterChefJoeV3 farm.
 * Also claims pending JOE rewards automatically (MCV3 behavior).
 *
 * Body: { userAddress, poolId, lpAmount, proxyAddress }
 * Returns: [unstake via executor]
 */
avaxLpRoutes.post(
  "/prepare-unstake",
  validateRequired("userAddress", "poolId", "lpAmount", "proxyAddress"),
  validateAddress("userAddress"),
  validateAddress("proxyAddress"),
  executionTimeout(),
  ctrl.prepareUnstake
);

/**
 * POST /avax/lp/prepare-claim-rewards
 * Builds a TransactionBundle to harvest pending JOE rewards from a farm.
 * Uses the deposit(pid, 0) harvest pattern of MasterChefJoeV3.
 *
 * Body: { userAddress, poolId, proxyAddress }
 * Returns: [claimRewards via executor]
 */
avaxLpRoutes.post(
  "/prepare-claim-rewards",
  validateRequired("userAddress", "poolId", "proxyAddress"),
  validateAddress("userAddress"),
  validateAddress("proxyAddress"),
  executionTimeout(),
  ctrl.prepareClaimRewards
);
