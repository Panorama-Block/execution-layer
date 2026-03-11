import { getContract } from "../providers/chain.provider";
import { ERC20_ABI } from "./abi";
import { isNativeETH } from "./encoding";

const DECIMAL_CACHE = new Map<string, number>();

export async function getTokenDecimals(token: string, chain: string = "base"): Promise<number> {
  if (isNativeETH(token)) {
    return 18;
  }

  const key = `${chain}:${token.toLowerCase()}`;
  const cached = DECIMAL_CACHE.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const contract = getContract(token, ERC20_ABI, chain);
  const decimals = Number(await contract.decimals());
  DECIMAL_CACHE.set(key, decimals);
  return decimals;
}

export async function formatExchangeRate(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  amountOut: bigint,
  precision: number = 8
): Promise<string> {
  if (amountIn === 0n) {
    return "0";
  }

  const [decimalsIn, decimalsOut] = await Promise.all([
    getTokenDecimals(tokenIn),
    getTokenDecimals(tokenOut),
  ]);

  const scale = 10n ** BigInt(precision);
  const numerator = amountOut * (10n ** BigInt(decimalsIn)) * scale;
  const denominator = amountIn * (10n ** BigInt(decimalsOut));
  const scaledRate = denominator === 0n ? 0n : numerator / denominator;

  return formatFixed(scaledRate, precision);
}

function formatFixed(value: bigint, decimals: number): string {
  if (decimals === 0) {
    return value.toString();
  }

  const base = 10n ** BigInt(decimals);
  const integerPart = value / base;
  let fractionalPart = (value % base).toString().padStart(decimals, "0");
  fractionalPart = fractionalPart.replace(/0+$/, "");

  return fractionalPart.length > 0
    ? `${integerPart.toString()}.${fractionalPart}`
    : integerPart.toString();
}
