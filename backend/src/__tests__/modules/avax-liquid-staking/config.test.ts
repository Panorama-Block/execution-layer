import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import { S_AVAX_ADDRESS, BENQI_APR_URL } from "../../../modules/avax-liquid-staking/config/avax-liquid-staking.config";

describe("avax-liquid-staking config", () => {
  it("S_AVAX_ADDRESS é um endereço Ethereum válido", () => {
    expect(ethers.isAddress(S_AVAX_ADDRESS)).toBe(true);
  });

  it("S_AVAX_ADDRESS é o contrato sAVAX correto na Avalanche mainnet", () => {
    expect(S_AVAX_ADDRESS.toLowerCase()).toBe("0x2b2c81e08f1af8835a78bb2a90ae924ace0ea4be");
  });

  it("BENQI_APR_URL é uma URL HTTPS válida", () => {
    expect(BENQI_APR_URL).toMatch(/^https:\/\/.+/);
  });

  it("BENQI_APR_URL aponta para o domínio correto da Benqi", () => {
    expect(BENQI_APR_URL).toContain("benqi.fi");
  });
});
