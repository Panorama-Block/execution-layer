import { Request, Response } from "express";
import { executePrepareSwapBundle } from "../usecases/prepare-swap.usecase";
import { executeGetSwapQuote } from "../usecases/get-quote.usecase";
import { executeGetSwapPairs } from "../usecases/get-swap-pairs.usecase";

export async function prepareSwap(req: Request, res: Response) {
  try {
    const { userAddress, tokenIn, tokenOut, amountIn, stable, slippageBps, deadlineMinutes } = req.body;
    if (!userAddress || !tokenIn || !tokenOut || !amountIn) {
      return res.status(400).json({
        error: "Missing required fields: userAddress, tokenIn, tokenOut, amountIn",
      });
    }
    const result = await executePrepareSwapBundle({
      userAddress,
      tokenIn,
      tokenOut,
      amountIn,
      stable,
      slippageBps,
      deadlineMinutes,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getQuote(req: Request, res: Response) {
  try {
    const { tokenIn, tokenOut, amountIn, stable, slippageBps } = req.body;
    if (!tokenIn || !tokenOut || !amountIn) {
      return res.status(400).json({
        error: "Missing required fields: tokenIn, tokenOut, amountIn",
      });
    }
    const result = await executeGetSwapQuote({ tokenIn, tokenOut, amountIn, stable, slippageBps });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getSwapPairs(_req: Request, res: Response) {
  try {
    const result = await executeGetSwapPairs();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
