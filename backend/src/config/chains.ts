export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorer: string;
  contracts: {
    panoramaExecutor: string;
    dcaVault: string;
    weth: string;
  };
}

/**
 * Parse comma-separated RPC URLs from env var, falling back to single URL.
 * Example: BASE_RPC_URLS="https://mainnet.base.org,https://base.llamarpc.com"
 */
function parseRpcUrls(listEnv: string | undefined, singleEnv: string | undefined, defaultUrl: string): string[] {
  if (listEnv) {
    const urls = listEnv.split(",").map(u => u.trim()).filter(Boolean);
    if (urls.length > 0) return urls;
  }
  return [singleEnv || defaultUrl];
}

export function getChainConfig(chain: string): ChainConfig {
  if (chain === "base") {
    const rpcUrls = parseRpcUrls(process.env.BASE_RPC_URLS, process.env.BASE_RPC_URL, "https://mainnet.base.org");
    return {
      chainId: 8453,
      name: "Base",
      rpcUrl: rpcUrls[0],
      rpcUrls,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      blockExplorer: "https://basescan.org",
      contracts: {
        panoramaExecutor: process.env.EXECUTOR_ADDRESS || "",
        dcaVault: process.env.DCA_VAULT_ADDRESS || "",
        weth: "0x4200000000000000000000000000000000000006",
      },
    };
  }

  if (chain === "avalanche") {
    const rpcUrls = parseRpcUrls(process.env.AVAX_RPC_URLS, process.env.AVAX_RPC_URL, "https://api.avax.network/ext/bc/C/rpc");
    return {
      chainId: 43114,
      name: "Avalanche C-Chain",
      rpcUrl: rpcUrls[0],
      rpcUrls,
      nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
      blockExplorer: "https://snowtrace.io",
      contracts: {
        panoramaExecutor: process.env.AVAX_EXECUTOR_ADDRESS || "",
        dcaVault: "",
        weth: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", // WAVAX
      },
    };
  }

  throw new Error(`Unsupported chain: ${chain}`);
}
