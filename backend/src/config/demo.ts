// ──────────────────────────────────────────────────────────────────
// DEMO ENVIRONMENT CONFIGURATION
//
// Fixed configuration for demo/presentation environments.
// Ensures deterministic behavior by:
//   - Using stable, paid RPC endpoints (not free/rate-limited ones)
//   - Pinning contract addresses and flow parameters
//   - Defining the canonical demo flow for presentations
//
// Usage:
//   NODE_ENV=demo npm run dev
//
// The demo config is consumed by chains.ts when NODE_ENV === "demo".
// It can also be used by scripts/tests that need known-good parameters.
// ──────────────────────────────────────────────────────────────────

export const DEMO_CONFIG = {
  // ── Chain ──────────────────────────────────────────────────────
  chain: "base" as const,
  chainId: 8453,

  // ── RPC Endpoints (priority order) ─────────────────────────────
  // In demo mode, prefer paid/stable endpoints to avoid rate limits
  // and flaky responses during presentations.
  //
  // Override via BASE_RPC_URLS env var (comma-separated).
  // These are the recommended defaults when no env var is set:
  rpcUrls: [
    "https://mainnet.base.org",         // Coinbase official — reliable but rate-limited
    "https://base.llamarpc.com",        // LlamaRPC — generous free tier
    "https://base.drpc.org",            // dRPC — backup
  ],

  // ── Deployed Contracts ─────────────────────────────────────────
  contracts: {
    panoramaExecutor: "0x82b000512A19f7B762A23033aEA5AE00aBD0D2bC",
    aerodromeAdapter: "0x187e499afB2DE75836800ad19147e0cFcd2Dc715",
    dcaVault:         "0x155eC4256cC6f11f3d4C21Af28a2a1CC31f730d1",
  },

  // ── Aerodrome Protocol ─────────────────────────────────────────
  aerodrome: {
    router:  "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
    factory: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
    voter:   "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5",
  },

  // ── Canonical Demo Flow ────────────────────────────────────────
  // This is the sequence used during presentations.
  // Each step maps to an API endpoint on the execution-layer.
  //
  // Flow: Swap ETH → USDC → Add Liquidity WETH/USDC → Stake LP
  //
  demoFlow: {
    description: "Base chain → Aerodrome swap → Liquidity add → Gauge stake",
    steps: [
      {
        name: "Swap ETH → USDC",
        endpoint: "POST /swap/prepare",
        params: {
          tokenIn: "0x0000000000000000000000000000000000000000",  // Native ETH
          tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
          amountIn: "10000000000000000",                           // 0.01 ETH
        },
      },
      {
        name: "Add Liquidity WETH/USDC",
        endpoint: "POST /staking/prepare-enter",
        params: {
          poolId: "weth-usdc-volatile",
          amountA: "5000000000000000",   // 0.005 WETH
          amountB: "15000000",           // 15 USDC (approx ratio)
        },
      },
      {
        name: "Check Position",
        endpoint: "GET /staking/position/:userAddress",
      },
      {
        name: "Claim Rewards",
        endpoint: "POST /staking/prepare-claim",
        params: {
          poolId: "weth-usdc-volatile",
        },
      },
      {
        name: "Exit Strategy",
        endpoint: "POST /staking/prepare-exit",
        params: {
          poolId: "weth-usdc-volatile",
        },
      },
    ],
  },

  // ── Demo Tokens ────────────────────────────────────────────────
  tokens: {
    ETH:  { address: "0x0000000000000000000000000000000000000000", decimals: 18 },
    WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6  },
    AERO: { address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
  },

  // ── Demo Pool ──────────────────────────────────────────────────
  pool: {
    id: "weth-usdc-volatile",
    poolAddress: "0xcDAC0d6c6C59727a65F871236188350531885C43",
    gaugeAddress: "0x519BBD1Dd8C6A94C46080E24f316c14Ee758C025",
  },

  // ── Timeouts & Limits ──────────────────────────────────────────
  // More generous timeouts for demo to avoid flaky failures.
  executionTimeoutMs: 20_000,    // 20s vs 15s default
  rpcTimeoutMs:       5_000,     // 5s vs 3.5s default
  slippageBps:        200,       // 2% — wider to avoid reverts during live demo
} as const;

/**
 * Returns true when the service is running in demo mode.
 * Checks NODE_ENV and the DEMO_MODE flag (for docker-compose overrides).
 */
export function isDemoMode(): boolean {
  return process.env.NODE_ENV === "demo" || process.env.DEMO_MODE === "true";
}
