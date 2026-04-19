/**
 * Metronome Synth markets on Base mainnet (8453).
 *
 * Architecture note: Metronome uses per-token contracts (not a monolithic Pool).
 *   - `depositToken` wraps the collateral asset (USDC → USDCDepositToken, etc.)
 *   - `debtToken` tracks the debt denominated in a synthetic asset (msUSD/msETH)
 *
 * When preparing a user operation, the frontend picks:
 *   - A collateral market → depositToken address
 *   - A synthetic market  → debtToken address
 */

export interface MetronomeCollateralMarket {
  symbol:          string;
  depositToken:    string;
  underlying:      string;
  underlyingSymbol: string;
  decimals:        number;
}

export interface MetronomeSyntheticMarket {
  symbol:    string;
  debtToken: string;
  synth:     string;
  decimals:  number;
}

export const METRONOME_COLLATERAL_MARKETS: MetronomeCollateralMarket[] = [
  {
    symbol:          "msdUSDC",
    depositToken:    "0xC7F2f79Daa7Ea4FBbF60b45b5D6028BDE2453476",
    underlying:      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // native USDC
    underlyingSymbol: "USDC",
    decimals:        6,
  },
  {
    symbol:          "msdWETH",
    depositToken:    "0x8b581d0013F571a792c3Aa8AF2a0366A309BF51E",
    underlying:      "0x4200000000000000000000000000000000000006", // WETH
    underlyingSymbol: "WETH",
    decimals:        18,
  },
];

export const METRONOME_SYNTHETIC_MARKETS: MetronomeSyntheticMarket[] = [
  {
    symbol:    "msUSD",
    debtToken: "0x7bcC1DEcCaa98D52Bf89485f17a3E8607011cFde",
    synth:     "0x526728DBc96689597F85ae4cd716d4f7fCcBAE9d",
    decimals:  18,
  },
  {
    symbol:    "msETH",
    debtToken: "0x6F622b037F9146bdE102db84FC9152dF1042aa98",
    synth:     "0x7Ba6F01772924a82D9626c126347A28299E98c98",
    decimals:  18,
  },
];

export function getCollateralMarketByDepositToken(depositToken: string): MetronomeCollateralMarket | undefined {
  return METRONOME_COLLATERAL_MARKETS.find(
    (m) => m.depositToken.toLowerCase() === depositToken.toLowerCase()
  );
}

export function getSyntheticMarketByDebtToken(debtToken: string): MetronomeSyntheticMarket | undefined {
  return METRONOME_SYNTHETIC_MARKETS.find(
    (m) => m.debtToken.toLowerCase() === debtToken.toLowerCase()
  );
}
