import { getContract } from "../providers/chain.provider";
import { ERC20_ABI } from "./abi";

// Cache decimals to avoid repeated RPC calls
const decimalsCache = new Map<string, number>();

/**
 * Fetch ERC-20 decimals for a token, with in-memory caching.
 * Returns 18 as fallback if the call fails.
 */
export async function getTokenDecimals(tokenAddress: string, chain = "base"): Promise<number> {
  const key = `${chain}:${tokenAddress.toLowerCase()}`;
  const cached = decimalsCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const contract = getContract(tokenAddress, ERC20_ABI, chain);
    // ethers v6 returns uint8 as bigint at runtime — coerce to number
    const decimals = Number(await contract.decimals());
    decimalsCache.set(key, decimals);
    return decimals;
  } catch {
    return 18;
  }
}

/**
 * Compute a decimal-aware exchange rate string.
 *
 * Uses bigint arithmetic to avoid Number precision loss on large amounts.
 *
 * @param amountOut     Raw output amount (bigint, in tokenOut's smallest unit)
 * @param amountIn      Raw input amount  (bigint, in tokenIn's smallest unit)
 * @param decimalsIn    Decimal places for tokenIn  (e.g. 6 for USDC)
 * @param decimalsOut   Decimal places for tokenOut (e.g. 18 for WETH)
 * @returns             Human-readable rate as a string, e.g. "0.00034210"
 */
export function formatExchangeRate(
  amountOut: bigint,
  amountIn: bigint,
  decimalsIn: number,
  decimalsOut: number
): string {
  if (amountIn === 0n) return "0";

  // Normalise both amounts to 18-decimal precision using bigint scaling.
  // All intermediate values are kept as bigint to avoid Number precision loss.
  const PRECISION = 18n;
  const dIn  = BigInt(decimalsIn);
  const dOut = BigInt(decimalsOut);

  const normIn  = dIn  <= PRECISION ? amountIn  * 10n ** (PRECISION - dIn)  : amountIn  / 10n ** (dIn  - PRECISION);
  const normOut = dOut <= PRECISION ? amountOut * 10n ** (PRECISION - dOut) : amountOut / 10n ** (dOut - PRECISION);

  // rate = normOut / normIn with 8 decimal places of precision
  const DECIMALS_OUT = 8n;
  const scaled = (normOut * 10n ** DECIMALS_OUT) / normIn;
  const intPart  = scaled / 10n ** DECIMALS_OUT;
  const fracPart = scaled % 10n ** DECIMALS_OUT;

  return `${intPart}.${fracPart.toString().padStart(Number(DECIMALS_OUT), "0")}`;
}
