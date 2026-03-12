import { getQuote } from "../../../providers/aerodrome.provider";
import { applySlippage } from "../../../utils/encoding";

export interface SwapQuoteRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  stable?: boolean;
  slippageBps?: number;
}

export interface SwapQuoteResponse {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  amountOutMin: string;
  stable: boolean;
  slippageBps: number;
  exchangeRate: string;
}

export async function executeGetSwapQuote(req: SwapQuoteRequest): Promise<SwapQuoteResponse> {
  const amountIn = BigInt(req.amountIn);
  const stable = req.stable ?? false;
  const slippageBps = req.slippageBps ?? 50;

  const { amountOut } = await getQuote(req.tokenIn, req.tokenOut, amountIn, stable);
  const amountOutMin = applySlippage(amountOut, slippageBps);

  const exchangeRate =
    amountIn > 0n
      ? (Number(amountOut) / Number(amountIn)).toFixed(8)
      : "0";

  return {
    tokenIn: req.tokenIn,
    tokenOut: req.tokenOut,
    amountIn: amountIn.toString(),
    amountOut: amountOut.toString(),
    amountOutMin: amountOutMin.toString(),
    stable,
    slippageBps,
    exchangeRate,
  };
}
