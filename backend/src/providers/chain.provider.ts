import { ethers } from "ethers";
import { getChainConfig } from "../config/chains";

const networks: Record<string, ethers.Network> = {
  base: ethers.Network.from(8453),
  avalanche: ethers.Network.from(43114),
};

const providers: Record<string, ethers.JsonRpcProvider | ethers.FallbackProvider> = {};

/**
 * Creates a provider with automatic fallback across multiple RPC endpoints.
 * If only one RPC URL is configured, returns a simple JsonRpcProvider.
 * If multiple are configured, returns a FallbackProvider that tries them in priority order.
 */
function createProvider(chain: string): ethers.JsonRpcProvider | ethers.FallbackProvider {
  const config = getChainConfig(chain);
  const network = networks[chain];

  if (config.rpcUrls.length === 1) {
    const opts = network ? { staticNetwork: network } : {};
    return new ethers.JsonRpcProvider(config.rpcUrls[0], network, opts);
  }

  // Multiple RPCs: create FallbackProvider with priority ordering
  const rpcProviders = config.rpcUrls.map((url, index) => {
    const opts = network ? { staticNetwork: network } : {};
    const provider = new ethers.JsonRpcProvider(url, network, opts);
    return {
      provider,
      priority: index + 1,   // lower = preferred (first URL is primary)
      stallTimeout: 2000,     // wait 2s before trying next provider
      weight: 1,
    };
  });

  console.log(`[ChainProvider] ${chain}: ${config.rpcUrls.length} RPC endpoints configured (fallback enabled)`);

  return new ethers.FallbackProvider(rpcProviders, network);
}

export function getProvider(chain: string): ethers.JsonRpcProvider | ethers.FallbackProvider {
  if (!providers[chain]) {
    providers[chain] = createProvider(chain);
  }
  return providers[chain];
}

export function getContract(
  address: string,
  abi: readonly string[],
  chain: string
): ethers.Contract {
  const provider = getProvider(chain);
  return new ethers.Contract(address, abi, provider);
}
