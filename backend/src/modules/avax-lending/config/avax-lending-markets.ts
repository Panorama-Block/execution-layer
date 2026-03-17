import { BENQI_MARKETS, AVAX_TOKENS } from "../../../shared/services/avax.service";

export interface AvaxLendingMarket {
  id:              string;
  qTokenAddress:   string;
  qTokenSymbol:    string;
  underlyingAddress?: string; // undefined = native AVAX
  underlyingSymbol: string;
  underlyingDecimals: number;
  isNative:        boolean;
  enabled:         boolean;
}

export const AVAX_LENDING_MARKETS: AvaxLendingMarket[] = [
  {
    id:                  "avax",
    qTokenAddress:       BENQI_MARKETS.qiAVAX.address,
    qTokenSymbol:        "qiAVAX",
    underlyingAddress:   undefined,
    underlyingSymbol:    "AVAX",
    underlyingDecimals:  18,
    isNative:            true,
    enabled:             true,
  },
  {
    id:                  "usdc.e",
    qTokenAddress:       BENQI_MARKETS.qiUSDCe.address,
    qTokenSymbol:        "qiUSDC",
    underlyingAddress:   AVAX_TOKENS.USDCe.address,
    underlyingSymbol:    "USDC.e",
    underlyingDecimals:  6,
    isNative:            false,
    enabled:             true,
  },
  {
    id:                  "usdt",
    qTokenAddress:       BENQI_MARKETS.qiUSDT.address,
    qTokenSymbol:        "qiUSDT",
    underlyingAddress:   AVAX_TOKENS.USDT.address,
    underlyingSymbol:    "USDT",
    underlyingDecimals:  6,
    isNative:            false,
    enabled:             true,
  },
  {
    id:                  "weth",
    qTokenAddress:       BENQI_MARKETS.qiETH.address,
    qTokenSymbol:        "qiETH",
    underlyingAddress:   AVAX_TOKENS.WETH.address,
    underlyingSymbol:    "WETH.e",
    underlyingDecimals:  18,
    isNative:            false,
    enabled:             true,
  },
];

export function getMarketById(id: string): AvaxLendingMarket | undefined {
  return AVAX_LENDING_MARKETS.find(m => m.id === id && m.enabled);
}

export function getMarketByQToken(qTokenAddress: string): AvaxLendingMarket | undefined {
  return AVAX_LENDING_MARKETS.find(
    m => m.qTokenAddress.toLowerCase() === qTokenAddress.toLowerCase() && m.enabled
  );
}

export function getEnabledMarkets(): AvaxLendingMarket[] {
  return AVAX_LENDING_MARKETS.filter(m => m.enabled);
}
