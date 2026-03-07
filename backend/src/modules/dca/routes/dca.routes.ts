import { Router } from "express";
import {
  prepareCreateOrder,
  prepareCancelOrder,
  getOrders,
  getOrder,
  getExecutableOrders,
} from "../controllers/dca.controller";

export const dcaRoutes = Router();

// Prepare transactions
dcaRoutes.post("/prepare-create", prepareCreateOrder);
dcaRoutes.post("/prepare-cancel", prepareCancelOrder);

// Order data
dcaRoutes.get("/orders/:userAddress", getOrders);
dcaRoutes.get("/order/:orderId", getOrder);

// Keeper endpoint — returns orders ready to execute
dcaRoutes.get("/executable", getExecutableOrders);
