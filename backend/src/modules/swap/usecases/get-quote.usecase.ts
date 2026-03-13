import { aerodromeService } from "../../../shared/services/aerodrome.service";
import { applySlippage } from "../../../utils/encoding";
import { getTokenDecimals, formatExchangeRate } from "../../../utils/tokenMath";

export interface SwapQuoteRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  /** Pass `"auto"` to try volatile + stable and return the best output. */
  stable?: boolean | "auto";
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
  const amountIn    = BigInt(req.amountIn);
  const slippageBps = req.slippageBps ?? 50;

  let amountOut: bigint;
  let stable: boolean;

  if (req.stable === "auto") {
    // Try both pool types, silently ignore missing pools, pick best output.
    let volatileOut = 0n;
    let stableOut   = 0n;

    try {
      ({ amountOut: volatileOut } = await aerodromeService.getQuote(req.tokenIn, req.tokenOut, amountIn, false));
    } catch { /* no volatile pool */ }

    try {
      ({ amountOut: stableOut } = await aerodromeService.getQuote(req.tokenIn, req.tokenOut, amountIn, true));
    } catch { /* no stable pool */ }

    if (volatileOut === 0n && stableOut === 0n) {
      throw new Error("No liquidity available on Aerodrome for this pair");
    }

    stable    = stableOut > volatileOut;
    amountOut = stable ? stableOut : volatileOut;
  } else {
    stable = req.stable ?? false;
    ({ amountOut } = await aerodromeService.getQuote(req.tokenIn, req.tokenOut, amountIn, stable));
  }

  const amountOutMin = applySlippage(amountOut, slippageBps);

  const [decimalsIn, decimalsOut] = await Promise.all([
    getTokenDecimals(req.tokenIn),
    getTokenDecimals(req.tokenOut),
  ]);
  const exchangeRate = formatExchangeRate(amountOut, amountIn, decimalsIn, decimalsOut);

  return {
    tokenIn:      req.tokenIn,
    tokenOut:     req.tokenOut,
    amountIn:     amountIn.toString(),
    amountOut:    amountOut.toString(),
    amountOutMin: amountOutMin.toString(),
    stable,
    slippageBps,
    exchangeRate,
  };
}
