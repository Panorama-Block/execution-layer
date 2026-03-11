import { Router } from "express";
import { prepareSwap, getQuote, getSwapPairs, submitSwapTx, getSwapTxStatus, getSwapHistory } from "../controllers/swap.controller";
import { asyncHandler } from "../../../middleware/errorHandler";
import { validateAddress, validateAmount, validateRequired, validateSlippage, validateTxHash } from "../../../middleware/validation";
import { requireSignedHistoryAccess, requireSignedTxSubmission } from "../../../middleware/auth";

export const swapRoutes = Router();

// Quote
swapRoutes.post("/quote",
  validateRequired("tokenIn", "tokenOut", "amountIn"),
  validateSlippage(),
  asyncHandler(getQuote)
);

// Prepare transaction bundle (approve if needed → swap)
swapRoutes.post("/prepare",
  validateRequired("userAddress", "tokenIn", "tokenOut", "amountIn"),
  validateAddress("userAddress"),
  validateAmount("amountIn"),
  validateSlippage(),
  asyncHandler(prepareSwap)
);

// Available pairs with on-chain data
swapRoutes.get("/pairs", asyncHandler(getSwapPairs));

// Transaction management
swapRoutes.post("/transaction/submit",
  validateRequired("txHash", "userAddress"),
  validateTxHash("txHash"),
  validateAddress("userAddress"),
  requireSignedTxSubmission("swap"),
  asyncHandler(submitSwapTx)
);

swapRoutes.get("/transaction/:txHash",
  validateTxHash("txHash", "params"),
  asyncHandler(getSwapTxStatus)
);

swapRoutes.get("/history/:userAddress",
  validateAddress("userAddress", "params"),
  requireSignedHistoryAccess("swap"),
  asyncHandler(getSwapHistory)
);
