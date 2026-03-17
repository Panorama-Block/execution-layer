import { AVAX_TOKENS } from "../../../shared/services/avax.service";

export interface AvaxSwapPairConfig {
  id: string;
  tokenIn:  { symbol: string; address: string; decimals: number };
  tokenOut: { symbol: string; address: string; decimals: number };
  enabled: boolean;
}

export const AVAX_SWAP_PAIRS: AvaxSwapPairConfig[] = [
  { id: "avax-usdc",   tokenIn: AVAX_TOKENS.WAVAX, tokenOut: AVAX_TOKENS.USDC,  enabled: true },
  { id: "usdc-avax",   tokenIn: AVAX_TOKENS.USDC,  tokenOut: AVAX_TOKENS.WAVAX, enabled: true },
  { id: "avax-usdt",   tokenIn: AVAX_TOKENS.WAVAX, tokenOut: AVAX_TOKENS.USDT,  enabled: true },
  { id: "usdt-avax",   tokenIn: AVAX_TOKENS.USDT,  tokenOut: AVAX_TOKENS.WAVAX, enabled: true },
  { id: "usdc-usdt",   tokenIn: AVAX_TOKENS.USDC,  tokenOut: AVAX_TOKENS.USDT,  enabled: true },
  { id: "usdt-usdc",   tokenIn: AVAX_TOKENS.USDT,  tokenOut: AVAX_TOKENS.USDC,  enabled: true },
  { id: "avax-weth",   tokenIn: AVAX_TOKENS.WAVAX, tokenOut: AVAX_TOKENS.WETH,  enabled: true },
  { id: "weth-avax",   tokenIn: AVAX_TOKENS.WETH,  tokenOut: AVAX_TOKENS.WAVAX, enabled: true },
];

export function getEnabledSwapPairs(): AvaxSwapPairConfig[] {
  return AVAX_SWAP_PAIRS.filter(p => p.enabled);
}

export function getSwapPairByTokens(tokenIn: string, tokenOut: string): AvaxSwapPairConfig | undefined {
  return AVAX_SWAP_PAIRS.find(
    p => p.tokenIn.address.toLowerCase()  === tokenIn.toLowerCase() &&
         p.tokenOut.address.toLowerCase() === tokenOut.toLowerCase()
  );
}
