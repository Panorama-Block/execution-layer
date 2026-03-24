import { ethers } from "ethers";
import { getChainConfig } from "../config/chains";

const networks: Record<string, ethers.Network> = {
  base: ethers.Network.from(8453),
  avalanche: ethers.Network.from(43114),
};

const providers: Record<string, ethers.JsonRpcProvider> = {};

/**
 * Creates a provider with sequential failover across multiple RPC endpoints.
 * Unlike ethers FallbackProvider (which requires quorum/consensus),
 * this uses the primary RPC and only falls back on failure.
 */
function createProvider(chain: string): ethers.JsonRpcProvider {
  const config = getChainConfig(chain);
  const network = networks[chain];

  // batchMaxCount: 1 — free RPCs reject large batches ("maximum 10 calls in 1 batch")
  const opts = network
    ? { staticNetwork: network, batchMaxCount: 1 }
    : { batchMaxCount: 1 };

  const primary = new ethers.JsonRpcProvider(config.rpcUrls[0], network, opts);

  if (config.rpcUrls.length <= 1) {
    return primary;
  }

  // Build fallback providers (lazy — only created on first failure)
  const fallbackUrls = config.rpcUrls.slice(1);
  let fallbackProviders: ethers.JsonRpcProvider[] | null = null;

  function getFallbacks(): ethers.JsonRpcProvider[] {
    if (!fallbackProviders) {
      fallbackProviders = fallbackUrls.map(
        (url) => new ethers.JsonRpcProvider(url, network, opts)
      );
    }
    return fallbackProviders;
  }

  console.log(`[ChainProvider] ${chain}: ${config.rpcUrls.length} RPC endpoints configured (failover enabled)`);

  // Per-RPC timeout — free RPCs often hang instead of failing cleanly.
  // Without this, a single slow RPC blocks the entire failover chain.
  const RPC_TIMEOUT_MS = 3500;

  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("rpc_call_timeout")), ms)
      ),
    ]);
  }

  // Wrap the primary provider's send method with timeout + parallel fallback.
  // Strategy: fire primary first; on failure, race all fallbacks simultaneously.
  const originalSend = primary.send.bind(primary);
  primary.send = async function failoverSend(method: string, params: any[]): Promise<any> {
    try {
      return await withTimeout(originalSend(method, params), RPC_TIMEOUT_MS);
    } catch (primaryError) {
      // Primary failed/timed out — race all fallbacks in parallel (fastest wins)
      const fallbacks = getFallbacks();
      if (fallbacks.length === 0) throw primaryError;

      // Race all fallbacks — first to succeed wins. If all reject, throw original.
      try {
        return await new Promise<any>((resolve, reject) => {
          let remaining = fallbacks.length;
          for (const fb of fallbacks) {
            withTimeout(fb.send(method, params), RPC_TIMEOUT_MS).then(
              resolve,
              () => { if (--remaining === 0) reject(primaryError); }
            );
          }
        });
      } catch {
        throw primaryError;
      }
    }
  };

  return primary;
}

export function getProvider(chain: string): ethers.JsonRpcProvider {
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
