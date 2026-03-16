import { avaxService, WAVAX } from "../../../shared/services/avax.service";
import { applySlippage } from "../../../utils/encoding";
import { AppError } from "../../../shared/errorCodes";

export interface GetAvaxQuoteRequest {
  tokenIn:    string;
  tokenOut:   string;
  amountIn:   string;
  slippageBps?: number;
}

export interface GetAvaxQuoteResponse {
  tokenIn:      string;
  tokenOut:     string;
  amountIn:     string;
  amountOut:    string;
  amountOutMin: string;
  path:         string[];
  slippageBps:  number;
  swapType:     "token-to-token" | "avax-to-token" | "token-to-avax";
}

export async function executeGetAvaxQuote(req: GetAvaxQuoteRequest): Promise<GetAvaxQuoteResponse> {
  const amountIn    = BigInt(req.amountIn);
  const slippageBps = req.slippageBps ?? 50;

  if (amountIn <= 0n) throw new AppError("INVALID_AMOUNT", "amountIn must be positive");

  const { amountOut, path } = await avaxService.getQuoteWithHop(req.tokenIn, req.tokenOut, amountIn);
  const amountOutMin        = applySlippage(amountOut, slippageBps);

  const isAvaxIn  = req.tokenIn.toLowerCase()  === WAVAX.toLowerCase();
  const isAvaxOut = req.tokenOut.toLowerCase() === WAVAX.toLowerCase();

  const swapType = isAvaxIn
    ? "avax-to-token"
    : isAvaxOut
      ? "token-to-avax"
      : "token-to-token";

  return {
    tokenIn:   req.tokenIn,
    tokenOut:  req.tokenOut,
    amountIn:  amountIn.toString(),
    amountOut: amountOut.toString(),
    amountOutMin: amountOutMin.toString(),
    path,
    slippageBps,
    swapType,
  };
}
