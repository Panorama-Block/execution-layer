export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorer: string;
  contracts: {
    panoramaExecutor: string;
    dcaVault: string;
    weth: string;
    panoramaSwap?: string;
    panoramaLend?: string;
  };
}

export function getChainConfig(chain: string): ChainConfig {
  if (chain === "base") {
    return {
      chainId: 8453,
      name: "Base",
      rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
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
    return {
      chainId: 43114,
      name: "Avalanche C-Chain",
      rpcUrl: process.env.AVAX_RPC_URL || "https://api.avax.network/ext/bc/C/rpc",
      nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
      blockExplorer: "https://snowtrace.io",
      contracts: {
        panoramaExecutor: "",
        dcaVault: "",
        weth: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", // WAVAX
        panoramaSwap: process.env.PANORAMA_SWAP_ADDRESS || "",
        panoramaLend: process.env.PANORAMA_LEND_ADDRESS || "",
      },
    };
  }

  throw new Error(`Unsupported chain: ${chain}`);
}
