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
    // Try both pool types in parallel, silently ignore missing pools, pick best output.
    const [volatileResult, stableResult] = await Promise.allSettled([
      aerodromeService.getQuote(req.tokenIn, req.tokenOut, amountIn, false),
      aerodromeService.getQuote(req.tokenIn, req.tokenOut, amountIn, true),
    ]);

    const volatileOut = volatileResult.status === "fulfilled" ? volatileResult.value.amountOut : 0n;
    const stableOut   = stableResult.status  === "fulfilled" ? stableResult.value.amountOut  : 0n;

    if (volatileOut === 0n && stableOut === 0n) {
      // Distinguish: if both calls rejected it's an RPC issue (retryable), not missing liquidity.
      if (volatileResult.status === "rejected" && stableResult.status === "rejected") {
        throw new Error(`RPC error fetching pool quotes. Please try again.`);
      }
      throw new Error("No liquidity available on Aerodrome for this pair");
    }

    // Only prefer stable pool if it's meaningfully better (≥1% = 100 bps).
    // Avoids picking thin stable pools that pass getAmountsOut but revert on-chain.
    stable    = stableOut > (volatileOut * 10100n) / 10000n;
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
