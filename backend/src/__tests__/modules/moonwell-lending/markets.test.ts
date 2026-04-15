import { describe, it, expect } from "vitest";
import {
  MOONWELL_MARKETS,
  getMarketById,
  getMarketByMToken,
  getEnabledMarkets,
} from "../../../modules/moonwell-lending/config/moonwell-markets";

describe("moonwell-markets config", () => {
  it("exporta 5 mercados", () => {
    expect(MOONWELL_MARKETS).toHaveLength(5);
  });

  it("todos os mercados têm endereços válidos (42 chars)", () => {
    for (const m of MOONWELL_MARKETS) {
      expect(m.mTokenAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(m.underlyingAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });

  it("getEnabledMarkets retorna apenas enabled=true", () => {
    const enabled = getEnabledMarkets();
    expect(enabled.every(m => m.enabled)).toBe(true);
  });

  it("getMarketById('usdc') retorna mUSDC", () => {
    const m = getMarketById("usdc");
    expect(m).toBeDefined();
    expect(m!.mTokenSymbol).toBe("mUSDC");
    expect(m!.underlyingDecimals).toBe(6);
  });

  it("getMarketById('weth') retorna mWETH e supportsEthVariant=true", () => {
    const m = getMarketById("weth");
    expect(m).toBeDefined();
    expect(m!.mTokenSymbol).toBe("mWETH");
    expect(m!.supportsEthVariant).toBe(true);
  });

  it("apenas mWETH tem supportsEthVariant=true", () => {
    const ethMarkets = MOONWELL_MARKETS.filter(m => m.supportsEthVariant);
    expect(ethMarkets).toHaveLength(1);
    expect(ethMarkets[0].id).toBe("weth");
  });

  it("getMarketByMToken encontra por endereço case-insensitive", () => {
    const addr = "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22";
    const m = getMarketByMToken(addr.toLowerCase());
    expect(m).toBeDefined();
    expect(m!.id).toBe("usdc");
  });

  it("getMarketById retorna undefined para id desconhecido", () => {
    expect(getMarketById("unknown")).toBeUndefined();
  });

  it("getMarketByMToken retorna undefined para endereço desconhecido", () => {
    expect(getMarketByMToken("0x0000000000000000000000000000000000000001")).toBeUndefined();
  });
});
