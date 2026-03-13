import { Router } from "express";
import {
  prepareEnterStrategy,
  prepareExitStrategy,
  prepareClaimRewards,
  getStakingPools,
  getPosition,
  getProtocolInfo,
  getPortfolio,
  submitTx,
  getTxStatus,
  getTxHistory,
} from "../controllers/staking.controller";
import { asyncHandler } from "../../../middleware/errorHandler";
import { validateAddress, validateAmount, validateRequired, validateSlippage, validateTxHash } from "../../../middleware/validation";
import { requireWalletAuth } from "../../../middleware/auth";

export const stakingRoutes = Router();

// Protocol info (APY, TVL)
stakingRoutes.get("/protocol-info", asyncHandler(getProtocolInfo));

// Pool data
stakingRoutes.get("/pools", asyncHandler(getStakingPools));

// Position data
stakingRoutes.get("/position/:userAddress",
  validateAddress("userAddress", "params"),
  asyncHandler(getPosition)
);

// Portfolio
stakingRoutes.get("/portfolio/:userAddress",
  validateAddress("userAddress", "params"),
  asyncHandler(getPortfolio)
);

// Strategy operations
stakingRoutes.post("/prepare-enter",
  validateRequired("userAddress", "poolId", "amountA", "amountB"),
  validateAddress("userAddress"),
  validateAmount("amountA"),
  validateAmount("amountB"),
  validateSlippage(),
  asyncHandler(prepareEnterStrategy)
);

stakingRoutes.post("/prepare-exit",
  validateRequired("userAddress", "poolId"),
  validateAddress("userAddress"),
  asyncHandler(prepareExitStrategy)
);

stakingRoutes.post("/prepare-claim",
  validateRequired("userAddress", "poolId"),
  validateAddress("userAddress"),
  asyncHandler(prepareClaimRewards)
);

// Transaction management
stakingRoutes.post("/transaction/submit",
  validateRequired("txHash", "userAddress", "signature", "timestamp"),
  validateTxHash("txHash"),
  validateAddress("userAddress"),
  requireWalletAuth,
  asyncHandler(submitTx)
);

stakingRoutes.get("/transaction/:txHash",
  validateTxHash("txHash", "params"),
  asyncHandler(getTxStatus)
);

stakingRoutes.get("/history/:userAddress",
  validateAddress("userAddress", "params"),
  requireWalletAuth,
  asyncHandler(getTxHistory)
);
