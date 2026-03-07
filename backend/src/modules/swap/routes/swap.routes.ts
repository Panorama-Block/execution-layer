import { Router } from "express";
import { prepareSwap, getQuote, getSwapPairs } from "../controllers/swap.controller";

export const swapRoutes = Router();

// Quote
swapRoutes.post("/quote", getQuote);

// Prepare transaction bundle (approve if needed → swap)
swapRoutes.post("/prepare", prepareSwap);

// Available pairs with on-chain data
swapRoutes.get("/pairs", getSwapPairs);
