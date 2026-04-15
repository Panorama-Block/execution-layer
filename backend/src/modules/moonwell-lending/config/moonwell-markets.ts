/**
 * Moonwell Finance market definitions for Base mainnet.
 * Moonwell is a Compound v2 fork — all markets use ERC20 underlyings.
 * There is NO native ETH market; the mWETH market wraps/unwraps WETH at the adapter level.
 *
 * Key addresses (Base mainnet):
 *   Comptroller: 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C
 *   WETH:        0x4200000000000000000000000000000000000006
 */

export interface MoonwellMarket {
  id:                   string;
  mTokenAddress:        string;
  mTokenSymbol:         string;
  underlyingAddress:    string;
  underlyingSymbol:     string;
  underlyingDecimals:   number;
  /** True for the mWETH market — ETH variants (supplyETH/redeemETH) are supported. */
  supportsEthVariant:   boolean;
  enabled:              boolean;
}

export const MOONWELL_MARKETS: MoonwellMarket[] = [
  {
    id:                 "usdc",
    mTokenAddress:      "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22",
    mTokenSymbol:       "mUSDC",
    underlyingAddress:  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    underlyingSymbol:   "USDC",
    underlyingDecimals: 6,
    supportsEthVariant: false,
    enabled:            true,
  },
  {
    id:                 "weth",
    mTokenAddress:      "0x628ff693426583D9a7FB391E54366292F509D457",
    mTokenSymbol:       "mWETH",
    underlyingAddress:  "0x4200000000000000000000000000000000000006",
    underlyingSymbol:   "WETH",
    underlyingDecimals: 18,
    supportsEthVariant: true,
    enabled:            true,
  },
  {
    id:                 "cbeth",
    mTokenAddress:      "0x3bf93770f2d4a794c3d9EBEfBAeBAE2a8f09A5E9",
    mTokenSymbol:       "mcbETH",
    underlyingAddress:  "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
    underlyingSymbol:   "cbETH",
    underlyingDecimals: 18,
    supportsEthVariant: false,
    enabled:            true,
  },
  {
    id:                 "dai",
    mTokenAddress:      "0x73b06D8d18De422E269645eaCe15400DE7462417",
    mTokenSymbol:       "mDAI",
    underlyingAddress:  "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    underlyingSymbol:   "DAI",
    underlyingDecimals: 18,
    supportsEthVariant: false,
    enabled:            true,
  },
  {
    id:                 "usdbc",
    mTokenAddress:      "0x703843C3379b52F9FF486c9f5892218d2a065cC8",
    mTokenSymbol:       "mUSDbC",
    underlyingAddress:  "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
    underlyingSymbol:   "USDbC",
    underlyingDecimals: 6,
    supportsEthVariant: false,
    enabled:            true,
  },
];

export function getMarketById(id: string): MoonwellMarket | undefined {
  return MOONWELL_MARKETS.find(m => m.id === id && m.enabled);
}

export function getMarketByMToken(mTokenAddress: string): MoonwellMarket | undefined {
  return MOONWELL_MARKETS.find(
    m => m.mTokenAddress.toLowerCase() === mTokenAddress.toLowerCase() && m.enabled
  );
}

export function getEnabledMarkets(): MoonwellMarket[] {
  return MOONWELL_MARKETS.filter(m => m.enabled);
}
