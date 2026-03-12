import { Router } from "express";
import { swapSupports, swapQuote, swapPrepare } from "../controllers/swap-provider.controller";

/**
 * Swap Provider API routes.
 * These endpoints are called by the Liquid Swap Service's AerodromeProviderAdapter.
 * Mounted at /swap in index.ts.
 */
export const swapProviderRoutes = Router();

swapProviderRoutes.post("/supports", swapSupports);
swapProviderRoutes.post("/quote", swapQuote);
swapProviderRoutes.post("/prepare", swapPrepare);
