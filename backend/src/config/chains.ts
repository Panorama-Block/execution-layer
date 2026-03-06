export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorer: string;
  contracts: {
    panoramaExecutor: string;
    weth: string;
  };
}

export const CHAINS: Record<string, ChainConfig> = {
  base: {
    chainId: 8453,
    name: "Base",
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorer: "https://basescan.org",
    contracts: {
      panoramaExecutor: process.env.EXECUTOR_ADDRESS || "",
      weth: "0x4200000000000000000000000000000000000006",
    },
  },
};

export function getChainConfig(chain: string): ChainConfig {
  const config = CHAINS[chain];
  if (!config) {
    throw new Error(`Unsupported chain: ${chain}`);
  }
  return config;
}
