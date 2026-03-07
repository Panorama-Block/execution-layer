export interface SwapPairConfig {
  id: string;
  tokenIn: {
    symbol: string;
    address: string;
    decimals: number;
  };
  tokenOut: {
    symbol: string;
    address: string;
    decimals: number;
  };
  stable: boolean;
  enabled: boolean;
}

// Pre-configured swap pairs on Base via Aerodrome
// Pool addresses are resolved dynamically via Factory.getPool()
export const SWAP_PAIRS: SwapPairConfig[] = [
  {
    id: "weth-usdc-volatile",
    tokenIn: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    tokenOut: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    stable: false,
    enabled: true,
  },
  {
    id: "usdc-weth-volatile",
    tokenIn: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    tokenOut: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    stable: false,
    enabled: true,
  },
  {
    id: "weth-aero-volatile",
    tokenIn: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    tokenOut: { symbol: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
    stable: false,
    enabled: true,
  },
  {
    id: "aero-weth-volatile",
    tokenIn: { symbol: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
    tokenOut: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    stable: false,
    enabled: true,
  },
  {
    id: "usdc-usdbc-stable",
    tokenIn: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    tokenOut: { symbol: "USDbC", address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6 },
    stable: true,
    enabled: true,
  },
  {
    id: "usdbc-usdc-stable",
    tokenIn: { symbol: "USDbC", address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6 },
    tokenOut: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    stable: true,
    enabled: true,
  },
  {
    id: "weth-cbbtc-volatile",
    tokenIn: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    tokenOut: { symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
    stable: false,
    enabled: true,
  },
  {
    id: "weth-wsteth-stable",
    tokenIn: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    tokenOut: { symbol: "wstETH", address: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452", decimals: 18 },
    stable: true,
    enabled: true,
  },
];

export function getSwapPairById(id: string): SwapPairConfig | undefined {
  return SWAP_PAIRS.find(p => p.id === id && p.enabled);
}

export function getEnabledSwapPairs(): SwapPairConfig[] {
  return SWAP_PAIRS.filter(p => p.enabled);
}

export function getSwapPairByTokens(
  tokenIn: string,
  tokenOut: string,
  stable: boolean
): SwapPairConfig | undefined {
  const i = tokenIn.toLowerCase();
  const o = tokenOut.toLowerCase();
  return SWAP_PAIRS.find(
    p =>
      p.enabled &&
      p.stable === stable &&
      p.tokenIn.address.toLowerCase() === i &&
      p.tokenOut.address.toLowerCase() === o
  );
}
