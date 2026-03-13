import { getChainConfig } from "../../../config/chains";
import { getDeadline, applySlippage } from "../../../utils/encoding";
import { TransactionBundle } from "../../../types/transaction";
import { aerodromeService } from "../../../shared/services/aerodrome.service";
import { buildAerodromeSwapBundle } from "../../../shared/aerodrome-swap";
import { getTokenDecimals, formatExchangeRate } from "../../../utils/tokenMath";

export interface PrepareSwapRequest {
  userAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  stable?: boolean;
  slippageBps?: number;
  deadlineMinutes?: number;
}

export interface PrepareSwapResponse {
  bundle: TransactionBundle;
  metadata: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut: string;
    amountOutMin: string;
    stable: boolean;
    slippageBps: number;
    exchangeRate: string;
    priceImpact: string;
    priceImpactNote: string;
  };
}

export async function executePrepareSwapBundle(
  req: PrepareSwapRequest
): Promise<PrepareSwapResponse> {
  const chain           = getChainConfig("base");
  const executorAddress = chain.contracts.panoramaExecutor;
  const amountIn        = BigInt(req.amountIn);
  const stable          = req.stable ?? false;
  const slippageBps     = req.slippageBps ?? 50;
  const deadlineMinutes = req.deadlineMinutes ?? 20;

  // Get quote on-chain
  const { amountOut } = await aerodromeService.getQuote(req.tokenIn, req.tokenOut, amountIn, stable);
  const amountOutMin  = applySlippage(amountOut, slippageBps);

  const deadline = getDeadline(deadlineMinutes);

  const builder = await buildAerodromeSwapBundle({
    userAddress:     req.userAddress,
    tokenIn:         req.tokenIn,
    tokenOut:        req.tokenOut,
    amountIn,
    amountOutMin,
    stable,
    deadline,
    executorAddress,
    chainId:         chain.chainId,
  });

  const [decimalsIn, decimalsOut] = await Promise.all([
    getTokenDecimals(req.tokenIn),
    getTokenDecimals(req.tokenOut),
  ]);

  const exchangeRate = formatExchangeRate(amountOut, amountIn, decimalsIn, decimalsOut);

  // Price impact is a rough route-derived estimate — not a true market impact.
  const priceImpact =
    amountIn > 0n
      ? (100 - (Number(amountOut) / Number(amountIn)) * 100).toFixed(4)
      : "0";

  return {
    bundle: builder.build(`Swap via Aerodrome (${stable ? "stable" : "volatile"} pool)`),
    metadata: {
      tokenIn: req.tokenIn,
      tokenOut: req.tokenOut,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      amountOutMin: amountOutMin.toString(),
      stable,
      slippageBps,
      exchangeRate,
      priceImpact,
      priceImpactNote: "Estimated from route quote. Actual impact may vary.",
    },
  };
}
