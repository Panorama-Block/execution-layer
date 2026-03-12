export interface ProtocolConfig {
  protocolId: string;
  name: string;
  chain: string;
  contracts: {
    router: string;
    factory: string;
    voter: string;
  };
  adapterAddress: string;
}

export const BASE_TOKENS: Record<string, { address: string; decimals: number }> = {
  ETH:    { address: "0x0000000000000000000000000000000000000000", decimals: 18 },
  WETH:   { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  USDC:   { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6  },
  USDbC:  { address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6  },
  AERO:   { address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
  cbBTC:  { address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8  },
  wstETH: { address: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452", decimals: 18 },
  cbETH:  { address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", decimals: 18 },
  DAI:    { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
};

// ── Protocol Registry ─────────────────────────────────────────────────────────

/**
 * Registry of all supported protocols.
 * To add a new protocol: call registerProtocol() at startup — no changes to this file.
 */
const PROTOCOL_REGISTRY: Record<string, ProtocolConfig> = {
  aerodrome: {
    protocolId: "aerodrome",
    name: "Aerodrome Finance",
    chain: "base",
    contracts: {
      router:  "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
      factory: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
      voter:   "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5",
    },
    adapterAddress: process.env.AERODROME_ADAPTER_ADDRESS || "",
  },
};

/**
 * Register a new protocol at runtime.
 * Call this during module initialisation — not needed for protocols already seeded above.
 *
 * @example
 *   registerProtocol("velodrome", { protocolId: "velodrome", ... });
 */
export function registerProtocol(protocolId: string, config: ProtocolConfig): void {
  PROTOCOL_REGISTRY[protocolId] = config;
}

/** Get config for a registered protocol. Throws for unknown protocols. */
export function getProtocolConfig(protocolId: string): ProtocolConfig {
  const config = PROTOCOL_REGISTRY[protocolId];
  if (!config) throw new Error(`Unsupported protocol: ${protocolId}`);
  return config;
}

/** List all registered protocol IDs. */
export function listProtocols(): string[] {
  return Object.keys(PROTOCOL_REGISTRY);
}

// ── User Adapter Address (EIP-1167 deterministic clone) ───────────────────────

const adapterCache      = new Map<string, { value: string; expiresAt: number }>();
const adapterInFlight   = new Map<string, Promise<string>>();
const ADAPTER_TTL_MS    = 10 * 60 * 1000;
const EMPTY_TTL_MS      = 30 * 1000;
const LOOKUP_TIMEOUT_MS = 3500;

function withTimeout<T>(fn: () => Promise<T>, ms = LOOKUP_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("adapter lookup timeout")), ms)),
  ]);
}

function isAdapterMissingError(err: unknown): boolean {
  const message = String((err as any)?.message || err || "").toLowerCase();
  const code    = String((err as any)?.code || "").toUpperCase();
  return (
    code === "CALL_EXCEPTION" ||
    message.includes("call_exception") ||
    message.includes("execution reverted") ||
    message.includes("missing revert data") ||
    message.includes("no data present") ||
    message.includes("require(false)")
  );
}

/**
 * Get the predicted per-user adapter clone address for a given protocol.
 * Uses PanoramaExecutor.predictUserAdapter() — deterministic, no tx needed.
 * Results are cached since the prediction is stable (same input → same output).
 */
export async function getUserAdapterAddress(userAddress: string, protocolId: string): Promise<string> {
  const cacheKey = `${protocolId}:${userAddress.toLowerCase()}`;
  const cached   = adapterCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  const inFlight = adapterInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async () => {
    const { getContract }           = await import("../providers/chain.provider");
    const { PANORAMA_EXECUTOR_ABI } = await import("../utils/abi");
    const { getChainConfig }        = await import("./chains");
    const { encodeProtocolId }      = await import("../utils/encoding");

    const chain    = getChainConfig("base");
    const executor = getContract(chain.contracts.panoramaExecutor, PANORAMA_EXECUTOR_ABI, "base");
    const protoId  = encodeProtocolId(protocolId);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const predicted: string = await withTimeout(
          () => executor.predictUserAdapter(protoId, userAddress)
        );
        const hasAddress = Boolean(predicted) && predicted !== "0x0000000000000000000000000000000000000000";
        adapterCache.set(cacheKey, {
          value:     hasAddress ? predicted : "",
          expiresAt: Date.now() + (hasAddress ? ADAPTER_TTL_MS : EMPTY_TTL_MS),
        });
        return predicted;
      } catch (err) {
        if (isAdapterMissingError(err)) {
          adapterCache.set(cacheKey, { value: "", expiresAt: Date.now() + EMPTY_TTL_MS });
          return "";
        }
        console.warn(
          `[getUserAdapterAddress] attempt ${attempt + 1} failed:`,
          err instanceof Error ? err.message : err
        );
        if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    adapterCache.set(cacheKey, { value: "", expiresAt: Date.now() + EMPTY_TTL_MS });
    return "";
  })();

  adapterInFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    adapterInFlight.delete(cacheKey);
  }
}
