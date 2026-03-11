import { Router } from "express";
import {
  prepareCreateOrder,
  prepareCancelOrder,
  getOrders,
  getOrder,
  getExecutableOrders,
  submitDcaTx,
  getDcaTxStatus,
  getDcaHistory,
} from "../controllers/dca.controller";
import { asyncHandler } from "../../../middleware/errorHandler";
import { validateAddress, validateRequired, validateTxHash } from "../../../middleware/validation";
import { requireSignedHistoryAccess, requireSignedTxSubmission } from "../../../middleware/auth";

export const dcaRoutes = Router();

// Prepare transactions
dcaRoutes.post("/prepare-create",
  validateRequired("userAddress", "tokenIn", "tokenOut", "amountPerSwap", "intervalSeconds", "depositAmount"),
  validateAddress("userAddress"),
  asyncHandler(prepareCreateOrder)
);

dcaRoutes.post("/prepare-cancel",
  validateRequired("userAddress", "orderId"),
  validateAddress("userAddress"),
  asyncHandler(prepareCancelOrder)
);

// Order data
dcaRoutes.get("/orders/:userAddress",
  validateAddress("userAddress", "params"),
  asyncHandler(getOrders)
);

dcaRoutes.get("/order/:orderId", asyncHandler(getOrder));

// Keeper endpoint
dcaRoutes.get("/executable", asyncHandler(getExecutableOrders));

// Transaction management
dcaRoutes.post("/transaction/submit",
  validateRequired("txHash", "userAddress"),
  validateTxHash("txHash"),
  validateAddress("userAddress"),
  requireSignedTxSubmission("dca"),
  asyncHandler(submitDcaTx)
);

dcaRoutes.get("/transaction/:txHash",
  validateTxHash("txHash", "params"),
  asyncHandler(getDcaTxStatus)
);

dcaRoutes.get("/history/:userAddress",
  validateAddress("userAddress", "params"),
  requireSignedHistoryAccess("dca"),
  asyncHandler(getDcaHistory)
);
