import { Request, Response } from "express";
import { asyncHandler } from "../../../middleware/errorHandler";
import { executeGetAvaxQuote }    from "../usecases/get-quote.usecase";
import { executePrepareAvaxSwap } from "../usecases/prepare-swap.usecase";
import { getEnabledSwapPairs }    from "../config/avax-swap-pairs";

export const getQuote = asyncHandler(async (req: Request, res: Response) => {
  const result = await executeGetAvaxQuote({
    tokenIn:    req.body.tokenIn,
    tokenOut:   req.body.tokenOut,
    amountIn:   req.body.amountIn,
    slippageBps: req.body.slippageBps,
  });
  res.json(result);
});

export const prepareSwap = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareAvaxSwap({
    userAddress:     req.body.userAddress,
    tokenIn:         req.body.tokenIn,
    tokenOut:        req.body.tokenOut,
    amountIn:        req.body.amountIn,
    slippageBps:     req.body.slippageBps,
    deadlineMinutes: req.body.deadlineMinutes,
  });
  res.json(result);
});

export const getPairs = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ pairs: getEnabledSwapPairs() });
});
