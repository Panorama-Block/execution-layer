import { Router } from "express";
import {
  getQuote,
  prepareSwap,
  prepareLiquidity,
  prepareStake,
  prepareUnstake,
  getPools,
  getPoolDetail,
} from "../controllers/execution.controller";

export const executionRoutes = Router();

// Quotes
executionRoutes.post("/quote", getQuote);

// Prepare transactions (returns unsigned calldata)
executionRoutes.post("/prepare-swap", prepareSwap);
executionRoutes.post("/prepare-liquidity", prepareLiquidity);
executionRoutes.post("/prepare-stake", prepareStake);
executionRoutes.post("/prepare-unstake", prepareUnstake);

// Pool data
executionRoutes.get("/pools", getPools);
executionRoutes.post("/pool-detail", getPoolDetail);
