export interface StakingPoolConfig {
  id: string;                    // unique identifier e.g. "weth-usdc-volatile"
  name: string;                  // display name e.g. "WETH/USDC Volatile"
  poolAddress: string;           // Aerodrome pool contract address (will be resolved on-chain)
  tokenA: {
    symbol: string;
    address: string;
    decimals: number;
  };
  tokenB: {
    symbol: string;
    address: string;
    decimals: number;
  };
  stable: boolean;               // true for stable pools, false for volatile
  rewardToken: {
    symbol: string;
    address: string;
    decimals: number;
  };
  enabled: boolean;              // can be disabled without removing
}

// Pre-configured staking pools on Base via Aerodrome
// Pool addresses are resolved dynamically via Factory.getPool()
// Gauge addresses are resolved dynamically via Voter.gauges()
export const STAKING_POOLS: StakingPoolConfig[] = [
  {
    id: "weth-usdc-volatile",
    name: "WETH/USDC Volatile",
    poolAddress: "", // resolved at runtime
    tokenA: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    tokenB: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    stable: false,
    rewardToken: { symbol: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
    enabled: true,
  },
  {
    id: "weth-aero-volatile",
    name: "WETH/AERO Volatile",
    poolAddress: "",
    tokenA: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    tokenB: { symbol: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
    stable: false,
    rewardToken: { symbol: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
    enabled: true,
  },
  {
    id: "usdc-usdbc-stable",
    name: "USDC/USDbC Stable",
    poolAddress: "",
    tokenA: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    tokenB: { symbol: "USDbC", address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6 },
    stable: true,
    rewardToken: { symbol: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
    enabled: true,
  },
  {
    id: "weth-usdc-stable",
    name: "WETH/USDC Stable",
    poolAddress: "",
    tokenA: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    tokenB: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    stable: true,
    rewardToken: { symbol: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
    enabled: true,
  },
];

// Helper to get pool config by id
export function getStakingPoolById(id: string): StakingPoolConfig | undefined {
  return STAKING_POOLS.find(p => p.id === id && p.enabled);
}

// Get all enabled pools
export function getEnabledStakingPools(): StakingPoolConfig[] {
  return STAKING_POOLS.filter(p => p.enabled);
}

// Get pool by token pair
export function getStakingPoolByTokens(tokenA: string, tokenB: string, stable: boolean): StakingPoolConfig | undefined {
  const a = tokenA.toLowerCase();
  const b = tokenB.toLowerCase();
  return STAKING_POOLS.find(p =>
    p.enabled &&
    p.stable === stable &&
    ((p.tokenA.address.toLowerCase() === a && p.tokenB.address.toLowerCase() === b) ||
     (p.tokenA.address.toLowerCase() === b && p.tokenB.address.toLowerCase() === a))
  );
}
