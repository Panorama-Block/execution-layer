import { ethers } from "ethers";
import { getChainConfig } from "../config/chains";

// ──────────────────────────────────────────────────────────────────
// STATIC NETWORK DEFINITIONS
// Pre-built Network objects avoid an extra RPC call to eth_chainId
// on every new provider. ethers normally auto-detects the network,
// but that adds latency and can fail on flaky RPCs.
// ──────────────────────────────────────────────────────────────────
const networks: Record<string, ethers.Network> = {
  base: ethers.Network.from(8453),
  avalanche: ethers.Network.from(43114),
};

// ──────────────────────────────────────────────────────────────────
// PROVIDER SINGLETON CACHE
// One provider per chain, created once and reused for all requests.
// This avoids reconnecting on every call and keeps connection pools alive.
// ──────────────────────────────────────────────────────────────────
const providers: Record<string, ethers.JsonRpcProvider> = {};

// ──────────────────────────────────────────────────────────────────
// RPC HEALTH TRACKING
// Tracks consecutive failures per RPC URL. If primary has failed
// recently, we start with fallbacks immediately instead of wasting
// 3.5s on a known-bad endpoint.
// ──────────────────────────────────────────────────────────────────
interface RpcHealth {
  consecutiveFailures: number;
  lastFailureAt: number;        // Date.now() timestamp
}

const rpcHealthMap = new Map<string, RpcHealth>();

/** How long a "sick" RPC stays deprioritized before we retry it. */
const HEALTH_RECOVERY_MS = 30_000; // 30 seconds

function markRpcFailed(url: string): void {
  const health = rpcHealthMap.get(url) ?? { consecutiveFailures: 0, lastFailureAt: 0 };
  health.consecutiveFailures++;
  health.lastFailureAt = Date.now();
  rpcHealthMap.set(url, health);
}

function markRpcHealthy(url: string): void {
  rpcHealthMap.delete(url); // healthy = no entry
}

/** Returns true if this RPC has been failing and hasn't recovered yet. */
function isRpcSick(url: string): boolean {
  const health = rpcHealthMap.get(url);
  if (!health) return false;
  // After HEALTH_RECOVERY_MS, give the RPC another chance
  if (Date.now() - health.lastFailureAt > HEALTH_RECOVERY_MS) {
    rpcHealthMap.delete(url);
    return false;
  }
  return health.consecutiveFailures >= 2;
}

// ──────────────────────────────────────────────────────────────────
// TIMEOUT UTILITY
// Wraps a promise with a deadline. Unlike a naive Promise.race with
// setTimeout, this version CLEARS the timer on success so we don't
// leak timers that keep Node.js alive unnecessarily.
// ──────────────────────────────────────────────────────────────────
const RPC_TIMEOUT_MS = 3_500;

function withTimeout<T>(promise: Promise<T>, ms: number = RPC_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("rpc_call_timeout"));
      }
    }, ms);

    promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      }
    );
  });
}

// ──────────────────────────────────────────────────────────────────
// PROVIDER FACTORY
// Creates a JsonRpcProvider for a chain. If multiple RPC URLs are
// configured, wraps the provider's .send() method with:
//   1. Timeout (3.5s) on the primary RPC
//   2. Health check — skip primary if it's been failing
//   3. Parallel fallback race — all fallbacks fire at once, first wins
//   4. Health tracking — mark RPCs as healthy/sick after each call
//   5. Logging — which RPC served each request
// ──────────────────────────────────────────────────────────────────
function createProvider(chain: string): ethers.JsonRpcProvider {
  const config = getChainConfig(chain);
  const network = networks[chain];

  // batchMaxCount: 1 — free/public RPCs reject batched JSON-RPC calls
  // ("maximum 10 calls in 1 batch" error). Disabling batching sends
  // each call individually, which is slower but compatible with all RPCs.
  const opts = network
    ? { staticNetwork: network, batchMaxCount: 1 }
    : { batchMaxCount: 1 };

  const allUrls = config.rpcUrls;
  const primary = new ethers.JsonRpcProvider(allUrls[0], network, opts);

  // Single RPC — no failover needed, return as-is
  if (allUrls.length <= 1) {
    console.log(`[ChainProvider] ${chain}: 1 RPC endpoint (no failover)`);
    return primary;
  }

  // ── Multiple RPCs: build failover wrapper ──

  // Fallback providers are created LAZILY on first failure.
  // This avoids opening connections we may never need.
  const fallbackUrls = allUrls.slice(1);
  let fallbackProviders: ethers.JsonRpcProvider[] | null = null;

  function getFallbacks(): ethers.JsonRpcProvider[] {
    if (!fallbackProviders) {
      fallbackProviders = fallbackUrls.map(
        (url: string) => new ethers.JsonRpcProvider(url, network, opts)
      );
    }
    return fallbackProviders;
  }

  console.log(
    `[ChainProvider] ${chain}: ${allUrls.length} RPC endpoints configured — ` +
    `primary: ${allUrls[0].replace(/^https?:\/\//, "").split("/")[0]}, ` +
    `fallbacks: ${fallbackUrls.map(u => u.replace(/^https?:\/\//, "").split("/")[0]).join(", ")}`
  );

  // ── Override .send() with failover logic ──
  // Every JSON-RPC call (eth_call, eth_getBalance, etc.) goes through
  // provider.send(). By wrapping it, we intercept at the lowest level.
  const originalSend = primary.send.bind(primary);

  primary.send = async function failoverSend(method: string, params: unknown[]): Promise<unknown> {
    const primaryUrl = allUrls[0];

    // ── Step 1: Try primary (unless it's been consistently failing) ──
    if (!isRpcSick(primaryUrl)) {
      try {
        const result = await withTimeout(originalSend(method, params));
        markRpcHealthy(primaryUrl);
        return result;
      } catch (err) {
        markRpcFailed(primaryUrl);
        console.warn(
          `[ChainProvider] ${chain} primary RPC failed (${method}): ` +
          `${err instanceof Error ? err.message : "unknown"}`
        );
      }
    } else {
      console.warn(`[ChainProvider] ${chain} primary RPC is sick — skipping to fallbacks`);
    }

    // ── Step 2: Race all fallbacks in parallel ──
    // Fire all at once. First successful response wins.
    // This is faster than trying sequentially (3.5s * N worst case).
    const fallbacks = getFallbacks();
    if (fallbacks.length === 0) {
      throw new Error(`[ChainProvider] ${chain}: all RPCs exhausted`);
    }

    return new Promise<unknown>((resolve, reject) => {
      let remaining = fallbacks.length;
      let resolved = false;

      fallbacks.forEach((fb, idx) => {
        const fbUrl = fallbackUrls[idx];
        withTimeout(fb.send(method, params)).then(
          (result) => {
            if (!resolved) {
              resolved = true;
              markRpcHealthy(fbUrl);
              console.log(`[ChainProvider] ${chain} fallback #${idx + 1} succeeded (${method})`);
              resolve(result);
            }
          },
          (err) => {
            markRpcFailed(fbUrl);
            remaining--;
            if (remaining === 0 && !resolved) {
              reject(new Error(
                `[ChainProvider] ${chain}: all ${allUrls.length} RPCs failed for ${method}`
              ));
            }
          }
        );
      });
    });
  };

  return primary;
}

// ──────────────────────────────────────────────────────────────────
// PUBLIC API
// ──────────────────────────────────────────────────────────────────

/**
 * Returns the singleton provider for a chain.
 * First call creates and caches the provider; subsequent calls reuse it.
 */
export function getProvider(chain: string): ethers.JsonRpcProvider {
  if (!providers[chain]) {
    providers[chain] = createProvider(chain);
  }
  return providers[chain];
}

/**
 * Creates a read-only Contract instance connected to the chain's provider.
 * No signer attached — these contracts can only read, not send transactions.
 */
export function getContract(
  address: string,
  abi: readonly string[],
  chain: string
): ethers.Contract {
  const provider = getProvider(chain);
  return new ethers.Contract(address, abi, provider);
}
