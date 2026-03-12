import { ethers } from "ethers";
import { getChainConfig } from "../config/chains";
import { BASE_TOKENS } from "../config/protocols";
import { getQuote } from "../providers/aerodrome.provider";
import { getPoolAddress } from "../providers/aerodrome.provider";
import { PANORAMA_EXECUTOR_ABI, ERC20_ABI } from "../utils/abi";
import { encodeProtocolId, encodeSwapExtraData, getDeadline, isNativeETH, applySlippage } from "../utils/encoding";
import { PreparedTransaction } from "../types/transaction";

const BASE_CHAIN_ID = 8453;
const WETH = "0x4200000000000000000000000000000000000006";
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
  // Only Base same-chain
  if (params.fromChainId !== BASE_CHAIN_ID || params.toChainId !== BASE_CHAIN_ID) {
    return { supported: false, reason: "Aerodrome only supports Base (8453)" };
  }

  const tokenIn = resolveTokenAddress(params.fromToken);
  const tokenOut = resolveTokenAddress(params.toToken);

  if (!tokenIn || !tokenOut) {
    return { supported: false, reason: "Token not recognized on Base" };
  }

  // Check if pool exists (try both volatile and stable)
  try {
    const volatilePool = await getPoolAddress(tokenIn, tokenOut, false);
    const stablePool = await getPoolAddress(tokenIn, tokenOut, true);
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
 * Returns amount out in wei + exchange rate.
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
  const tokenIn = resolveTokenAddress(params.fromToken);
  const tokenOut = resolveTokenAddress(params.toToken);

  if (!tokenIn || !tokenOut) {
    throw new Error("Token not supported on Aerodrome");
  }

  const amountIn = BigInt(params.amount);

  // Try volatile first, then stable — pick best output
  let bestAmountOut = 0n;
  let bestStable = false;

  try {
    const { amountOut: volatileOut } = await getQuote(tokenIn, tokenOut, amountIn, false);
    bestAmountOut = volatileOut;
    bestStable = false;
  } catch {
    // no volatile pool
  }

  try {
    const { amountOut: stableOut } = await getQuote(tokenIn, tokenOut, amountIn, true);
    if (stableOut > bestAmountOut) {
      bestAmountOut = stableOut;
      bestStable = true;
    }
  } catch {
    // no stable pool
  }

  if (bestAmountOut === 0n) {
    throw new Error("No liquidity available on Aerodrome for this pair");
  }

  const exchangeRate = amountIn > 0n
    ? Number(bestAmountOut) / Number(amountIn)
    : 0;

  return {
    estimatedReceiveAmount: bestAmountOut.toString(),
    bridgeFee: "0",
    gasFee: "0",
    exchangeRate,
    estimatedDuration: 15, // ~2 blocks on Base
    stable: bestStable,
  };
}

/**
 * Prepare swap transactions for user signature.
 * Returns array of transactions: [approval (if needed), swap].
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
  metadata: Record<string, any>;
}> {
  const chain = getChainConfig("base");
  const tokenIn = resolveTokenAddress(params.fromToken);
  const tokenOut = resolveTokenAddress(params.toToken);

  if (!tokenIn || !tokenOut) {
    throw new Error("Token not supported on Aerodrome");
  }

  const amountIn = BigInt(params.amount);
  const receiver = params.receiver || params.sender;

  // Get best quote (volatile vs stable)
  const quoteResult = await executeSwapQuote({
    fromToken: params.fromToken,
    toToken: params.toToken,
    amount: params.amount,
    sender: params.sender,
  });

  const amountOutMin = applySlippage(BigInt(quoteResult.estimatedReceiveAmount), 50); // 0.5% slippage
  const stable = quoteResult.stable;

  const transactions: PreparedTransaction[] = [];

  // 1. Approval transaction (if ERC20, not native ETH)
  if (!isNativeETH(tokenIn)) {
    const erc20Iface = new ethers.Interface(ERC20_ABI);
    const approveData = erc20Iface.encodeFunctionData("approve", [
      chain.contracts.panoramaExecutor,
      ethers.MaxUint256, // MaxUint256 approval (matches Uniswap pattern)
    ]);

    transactions.push({
      to: tokenIn,
      data: approveData,
      value: "0",
      chainId: BASE_CHAIN_ID,
      description: `Approve ${getTokenSymbol(tokenIn)} for PanoramaExecutor`,
    });
  }

  // 2. Swap transaction via PanoramaExecutor
  const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI);
  const protocolId = encodeProtocolId("aerodrome");
  const extraData = encodeSwapExtraData(stable);
  const deadline = getDeadline(20);

  const swapData = iface.encodeFunctionData("executeSwap", [
    protocolId,
    tokenIn,
    tokenOut,
    amountIn,
    amountOutMin,
    extraData,
    deadline,
  ]);

  const value = isNativeETH(tokenIn) ? amountIn.toString() : "0";

  transactions.push({
    to: chain.contracts.panoramaExecutor,
    data: swapData,
    value,
    chainId: BASE_CHAIN_ID,
    description: `Swap ${getTokenSymbol(tokenIn)} → ${getTokenSymbol(tokenOut)} via Aerodrome`,
  });

  return {
    transactions,
    estimatedDuration: 15,
    metadata: {
      protocol: "aerodrome",
      stable,
      amountOutMin: amountOutMin.toString(),
      executor: chain.contracts.panoramaExecutor,
    },
  };
}

/**
 * Resolve a token address from either an address or symbol.
 * Handles: "0x833589..." (address), "USDC" (symbol), "native" (ETH).
 */
function resolveTokenAddress(token: string): string | null {
  if (!token) return null;

  // "native" means ETH
  if (token.toLowerCase() === "native") {
    return ETH_ADDRESS;
  }

  // Already an address
  if (token.startsWith("0x") && token.length === 42) {
    return token;
  }

  // Try symbol lookup
  const upper = token.toUpperCase();
  const info = BASE_TOKENS[upper];
  return info ? info.address : null;
}

function getTokenSymbol(address: string): string {
  return ADDRESS_TO_SYMBOL[address.toLowerCase()] || address.slice(0, 10);
}
