export interface StakingPoolConfig {
  id: string;                    // unique identifier e.g. "weth-usdc-volatile"
  name: string;                  // display name e.g. "WETH/USDC Volatile"
  poolAddress: string;           // Aerodrome pool contract address (can be pre-configured)
  gaugeAddress?: string;         // Optional pre-configured gauge address
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
// Pool/Gauge addresses can be pre-configured for faster and more reliable reads.
// When omitted, they are resolved dynamically via Factory/Voter.
export const STAKING_POOLS: StakingPoolConfig[] = [
  {
    id: "weth-usdc-volatile",
    name: "WETH/USDC Volatile",
    poolAddress: "0xcDAC0d6c6C59727a65F871236188350531885C43",
    gaugeAddress: "0x519BBD1Dd8C6A94C46080E24f316c14Ee758C025",
    tokenA: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    tokenB: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    stable: false,
    rewardToken: { symbol: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
    enabled: true,
  },
  {
    id: "weth-aero-volatile",
    name: "WETH/AERO Volatile",
    poolAddress: "0x7f670f78B17dEC44d5Ef68a48740b6f8849cc2e6",
    gaugeAddress: "0x96a24aB830D4ec8b1F6f04Ceac104F1A3b211a01",
    tokenA: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    tokenB: { symbol: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
    stable: false,
    rewardToken: { symbol: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
    enabled: true,
  },
  {
    id: "usdc-usdbc-stable",
    name: "USDC/USDbC Stable",
    poolAddress: "0x27a8Afa3Bd49406e48a074350fB7b2020c43B2bD",
    gaugeAddress: "0x1Cfc45C5221A07DA0DE958098A319a29FbBD66fE",
    tokenA: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    tokenB: { symbol: "USDbC", address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6 },
    stable: true,
    rewardToken: { symbol: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
    enabled: true,
  },
  {
    id: "weth-usdc-stable",
    name: "WETH/USDC Stable",
    poolAddress: "0x3548029694fbB241D45FB24Ba0cd9c9d4E745f16",
    gaugeAddress: "0xaeBA79D1108788E5754Eb30aaC64EB868a3247FC",
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
