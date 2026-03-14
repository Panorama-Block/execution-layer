import { ethers } from "ethers";
import { getChainConfig } from "../config/chains";
import { BASE_TOKENS } from "../config/protocols";
import { aerodromeService } from "../shared/services/aerodrome.service";
import { executeGetSwapQuote } from "../modules/swap/usecases/get-quote.usecase";
import { executePrepareSwapBundle } from "../modules/swap/usecases/prepare-swap.usecase";
import { PreparedTransaction } from "../types/transaction";

const BASE_CHAIN_ID = 8453;
const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

// Token address -> symbol lookup (reverse of BASE_TOKENS)
const ADDRESS_TO_SYMBOL: Record<string, string> = {};
for (const [symbol, info] of Object.entries(BASE_TOKENS)) {
  ADDRESS_TO_SYMBOL[info.address.toLowerCase()] = symbol;
}

/**
 * Check if Aerodrome supports a given swap route.
 * Only supports same-chain Base (8453) swaps.
 */
export async function executeSupportsRoute(params: {
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
}): Promise<{ supported: boolean; reason?: string }> {
  if (params.fromChainId !== BASE_CHAIN_ID || params.toChainId !== BASE_CHAIN_ID) {
    return { supported: false, reason: "Aerodrome only supports Base (8453)" };
  }

  const tokenIn  = resolveTokenAddress(params.fromToken);
  const tokenOut = resolveTokenAddress(params.toToken);

  if (!tokenIn || !tokenOut) {
    return { supported: false, reason: "Token not recognized on Base" };
  }

  try {
    const volatilePool = await aerodromeService.getPoolAddress(tokenIn, tokenOut, false);
    const stablePool   = await aerodromeService.getPoolAddress(tokenIn, tokenOut, true);
    const hasPool =
      volatilePool !== ethers.ZeroAddress || stablePool !== ethers.ZeroAddress;

    return hasPool
      ? { supported: true }
      : { supported: false, reason: "No Aerodrome pool exists for this pair" };
  } catch {
    return { supported: false, reason: "Failed to check pool availability" };
  }
}

/**
 * Get a swap quote from Aerodrome.
 * Delegates to the canonical get-quote usecase with best-of-two pool selection.
 */
export async function executeSwapQuote(params: {
  fromToken: string;
  toToken: string;
  amount: string;
  sender: string;
}): Promise<{
  estimatedReceiveAmount: string;
  bridgeFee: string;
  gasFee: string;
  exchangeRate: number;
  estimatedDuration: number;
  stable: boolean;
}> {
  const tokenIn  = resolveTokenAddress(params.fromToken);
  const tokenOut = resolveTokenAddress(params.toToken);

  if (!tokenIn || !tokenOut) {
    throw new Error("Token not supported on Aerodrome");
  }

  const result = await executeGetSwapQuote({
    tokenIn, tokenOut, amountIn: params.amount, stable: "auto",
  });

  return {
    estimatedReceiveAmount: result.amountOut,
    bridgeFee:              "0",
    gasFee:                 "0",
    exchangeRate:           Number(result.exchangeRate),
    estimatedDuration:      15,
    stable:                 result.stable,
  };
}

/**
 * Prepare swap transactions for user signature.
 * Delegates to the canonical prepare-swap usecase.
 * Returns PreparedTransaction[] (shape expected by Liquid Swap Service).
 */
export async function executeSwapPrepare(params: {
  fromToken: string;
  toToken: string;
  amount: string;
  sender: string;
  receiver?: string;
}): Promise<{
  transactions: PreparedTransaction[];
  estimatedDuration: number;
  metadata: Record<string, unknown>;
}> {
  const chain    = getChainConfig("base");
  const tokenIn  = resolveTokenAddress(params.fromToken);
  const tokenOut = resolveTokenAddress(params.toToken);

  if (!tokenIn || !tokenOut) {
    throw new Error("Token not supported on Aerodrome");
  }

  // Resolve best pool type first
  const quote = await executeGetSwapQuote({
    tokenIn, tokenOut, amountIn: params.amount, stable: "auto",
  });

  // Delegate bundle construction to the canonical usecase.
  // Pass amountOut from the quote already obtained to skip the redundant on-chain getQuote call.
  const result = await executePrepareSwapBundle({
    userAddress:          params.receiver || params.sender,
    tokenIn,
    tokenOut,
    amountIn:             params.amount,
    stable:               quote.stable,
    slippageBps:          50,
    deadlineMinutes:      20,
    amountOutPrecomputed: quote.amountOut,
  });

  return {
    transactions:      result.bundle.steps,
    estimatedDuration: 15,
    metadata: {
      protocol:    "aerodrome",
      stable:      quote.stable,
      amountOutMin: result.metadata.amountOutMin,
      executor:    chain.contracts.panoramaExecutor,
    },
  };
}

/**
 * Resolve a token address from either an address or symbol.
 * Handles: "0x833589..." (address), "USDC" (symbol), "native" (ETH).
 */
function resolveTokenAddress(token: string): string | null {
  if (!token) return null;

  if (token.toLowerCase() === "native") {
    return ETH_ADDRESS;
  }

  if (token.startsWith("0x") && token.length === 42) {
    return token;
  }

  const upper = token.toUpperCase();
  const info  = BASE_TOKENS[upper];
  return info ? info.address : null;
}
