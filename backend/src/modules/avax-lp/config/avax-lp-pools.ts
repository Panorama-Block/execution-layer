import { AVAX_TOKENS } from "../../../shared/services/avax.service";

export interface LpPool {
  id:          string;
  tokenA:      { symbol: string; address: string; decimals: number };
  tokenB:      { symbol: string; address: string; decimals: number };
  pairAddress: string;
  // MasterChefJoeV3 pool id — null if no active farm emission
  farmPid:     number | null;
  enabled:     boolean;
}

// TraderJoe V1 Factory: 0x9Ad6C38BE94206cA50bb0d90783171662CD1e917
// MasterChefJoeV3:      0x188bED1968b795d5c9022F6a0bb5931Ac4c18F00
export const AVAX_LP_POOLS: LpPool[] = [
  {
    id:          "wavax-usdc.e",
    tokenA:      AVAX_TOKENS.WAVAX,
    tokenB:      AVAX_TOKENS.USDCe,
    pairAddress: "0xA389f9430876455C36478DeEa9769B7Ca4E3DDB1",
    farmPid:     42,
    enabled:     true,
  },
  {
    id:          "wavax-usdt",
    tokenA:      AVAX_TOKENS.WAVAX,
    tokenB:      AVAX_TOKENS.USDT,
    pairAddress: "0xbb4646a764358ee93c2a9c4a147537f9cf7f2Bc5",
    farmPid:     null,
    enabled:     true,
  },
  {
    id:          "wavax-joe",
    tokenA:      AVAX_TOKENS.WAVAX,
    tokenB:      { symbol: "JOE", address: "0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd", decimals: 18 },
    pairAddress: "0x454E67025631C065d3cFAD6d71E6892f74487a15",
    farmPid:     0,
    enabled:     true,
  },
  {
    id:          "wavax-weth.e",
    tokenA:      AVAX_TOKENS.WAVAX,
    tokenB:      AVAX_TOKENS.WETH,
    pairAddress: "0xFE15c2695F1F920da45C30AAE47d11dE51007AF9",
    farmPid:     null,
    enabled:     true,
  },
];

export function getEnabledPools(): LpPool[] {
  return AVAX_LP_POOLS.filter(p => p.enabled);
}

export function getPoolById(id: string): LpPool | undefined {
  return AVAX_LP_POOLS.find(p => p.id === id);
}

export function getPoolByPair(tokenA: string, tokenB: string): LpPool | undefined {
  const a = tokenA.toLowerCase();
  const b = tokenB.toLowerCase();
  return AVAX_LP_POOLS.find(
    p =>
      (p.tokenA.address.toLowerCase() === a && p.tokenB.address.toLowerCase() === b) ||
      (p.tokenA.address.toLowerCase() === b && p.tokenB.address.toLowerCase() === a)
  );
}

export function getPoolByPid(pid: number): LpPool | undefined {
  return AVAX_LP_POOLS.find(p => p.farmPid === pid);
}
