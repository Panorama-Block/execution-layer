import { Request, Response } from "express";
import { executeSupportsRoute, executeSwapQuote, executeSwapPrepare } from "../usecases/swap-provider.usecase";

/**
 * POST /swap/supports
 * Check if Aerodrome supports a given swap route.
 */
export async function swapSupports(req: Request, res: Response) {
  try {
    const { fromChainId, toChainId, fromToken, toToken } = req.body;
    if (!fromChainId || !toChainId || !fromToken || !toToken) {
      return res.status(400).json({ error: "Missing: fromChainId, toChainId, fromToken, toToken" });
    }
    const result = await executeSupportsRoute({ fromChainId, toChainId, fromToken, toToken });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /swap/quote
 * Get a swap quote from Aerodrome.
 */
export async function swapQuote(req: Request, res: Response) {
  try {
    const { fromToken, toToken, amount, sender } = req.body;
    if (!fromToken || !toToken || !amount || !sender) {
      return res.status(400).json({ error: "Missing: fromToken, toToken, amount, sender" });
    }
    const result = await executeSwapQuote({ fromToken, toToken, amount, sender });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /swap/prepare
 * Prepare swap transactions (approval + swap) for user signature.
 */
export async function swapPrepare(req: Request, res: Response) {
  try {
    const { fromToken, toToken, amount, sender, receiver } = req.body;
    if (!fromToken || !toToken || !amount || !sender) {
      return res.status(400).json({ error: "Missing: fromToken, toToken, amount, sender" });
    }
    const result = await executeSwapPrepare({ fromToken, toToken, amount, sender, receiver });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
