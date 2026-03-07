import { Router } from "express";
import {
  prepareEnterStrategy,
  prepareExitStrategy,
  prepareClaimRewards,
  getStakingPools,
  getPosition,
} from "../controllers/staking.controller";

export const stakingRoutes = Router();

// Strategy operations
stakingRoutes.post("/prepare-enter", prepareEnterStrategy);
stakingRoutes.post("/prepare-exit", prepareExitStrategy);
stakingRoutes.post("/prepare-claim", prepareClaimRewards);

// Pool data
stakingRoutes.get("/pools", getStakingPools);

// Position data
stakingRoutes.get("/position/:userAddress", getPosition);
