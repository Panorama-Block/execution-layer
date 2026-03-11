import { getQuote } from "../providers/aerodrome.provider";
import { formatExchangeRate } from "../utils/tokenMath";

export interface QuoteRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  stable?: boolean;
}

export interface QuoteResponse {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  rate: string;
  stable: boolean;
}

export async function executeGetQuote(req: QuoteRequest): Promise<QuoteResponse> {
  const amountIn = BigInt(req.amountIn);
  const stable = req.stable ?? false;

  const { amountOut } = await getQuote(req.tokenIn, req.tokenOut, amountIn, stable);
  const rate = await formatExchangeRate(req.tokenIn, req.tokenOut, amountIn, amountOut, 6);

  return {
    tokenIn: req.tokenIn,
    tokenOut: req.tokenOut,
    amountIn: amountIn.toString(),
    amountOut: amountOut.toString(),
    rate,
    stable,
  };
}
