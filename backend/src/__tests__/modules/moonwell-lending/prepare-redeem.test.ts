import { describe, it, expect, vi } from "vitest";
import { ethers } from "ethers";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../../config/chains", () => ({
  getChainConfig: vi.fn(() => ({
    chainId: 8453,
    name: "Base",
    contracts: { panoramaExecutor: "0x1111111111111111111111111111111111111111" },
  })),
}));

vi.mock("../../../providers/chain.provider", () => ({
  getProvider: vi.fn(() => ({
    estimateGas: vi.fn().mockResolvedValue(150000n),
    getFeeData:  vi.fn().mockResolvedValue({ gasPrice: 1000000n }),
  })),
  getContract: vi.fn(() => ({
    allowance: vi.fn().mockResolvedValue(0n),
  })),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { executePrepareRedeem } from "../../../modules/moonwell-lending/usecases/prepare-redeem.usecase";
import { MOONWELL_SELECTORS, PANORAMA_EXECUTOR_ABI_EXECUTE } from "../../../shared/bundle-builder";

const EXECUTOR = "0x1111111111111111111111111111111111111111";
const USER     = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const M_USDC   = "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22";
const M_WETH   = "0x628ff693426583D9a7FB391E54366292F509D457";

function decodeExecuteStep(data: string) {
  const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
  return iface.decodeFunctionData("execute", data);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("moonwell-lending: prepare-redeem (ERC20)", () => {
  it("retorna bundle com 2 steps: approve mToken + redeem", async () => {
    const { bundle } = await executePrepareRedeem({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "5000000000", // mUSDC amount
    });

    expect(bundle.steps).toHaveLength(2);
    expect(bundle.totalSteps).toBe(2);
  });

  it("step 0 é approve do mToken (não do underlying)", async () => {
    const { bundle } = await executePrepareRedeem({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "5000000000",
    });

    // approve deve ser no mToken, não no underlying
    expect(bundle.steps[0].to.toLowerCase()).toBe(M_USDC.toLowerCase());
  });

  it("step 1 é direcionado ao executor", async () => {
    const { bundle } = await executePrepareRedeem({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "5000000000",
    });

    expect(bundle.steps[1].to.toLowerCase()).toBe(EXECUTOR.toLowerCase());
  });

  it("step 1 usa selector REDEEM correto", async () => {
    const { bundle } = await executePrepareRedeem({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "5000000000",
    });

    const decoded = decodeExecuteStep(bundle.steps[1].data);
    expect(decoded[1]).toBe(MOONWELL_SELECTORS.REDEEM);
  });

  it("step 1 não envia value (redeem ERC20)", async () => {
    const { bundle } = await executePrepareRedeem({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "5000000000",
    });

    expect(bundle.steps[1].value).toBe("0");
  });

  it("metadata.action é 'redeem'", async () => {
    const { metadata } = await executePrepareRedeem({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "5000000000",
    });

    expect(metadata.action).toBe("redeem");
  });

  it("metadata.mTokenSymbol é 'mUSDC'", async () => {
    const { metadata } = await executePrepareRedeem({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "5000000000",
    });

    expect(metadata.mTokenSymbol).toBe("mUSDC");
  });

  it("metadata.useNativeETH é false para USDC", async () => {
    const { metadata } = await executePrepareRedeem({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "5000000000",
    });

    expect(metadata.useNativeETH).toBe(false);
  });

  it("chainId é 8453 (Base) em todos os steps", async () => {
    const { bundle } = await executePrepareRedeem({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "5000000000",
    });

    for (const step of bundle.steps) {
      expect(step.chainId).toBe(8453);
    }
  });

  it("lança AppError para amount zero", async () => {
    await expect(
      executePrepareRedeem({ userAddress: USER, mTokenAddress: M_USDC, amount: "0" })
    ).rejects.toThrow();
  });

  it("lança AppError para mToken desconhecido", async () => {
    await expect(
      executePrepareRedeem({
        userAddress:   USER,
        mTokenAddress: "0x0000000000000000000000000000000000000001",
        amount:        "1000",
      })
    ).rejects.toThrow();
  });
});

describe("moonwell-lending: prepare-redeem (native ETH via redeemETH)", () => {
  it("usa selector REDEEM_ETH para mWETH com useNativeETH=true", async () => {
    const { bundle } = await executePrepareRedeem({
      userAddress:   USER,
      mTokenAddress: M_WETH,
      amount:        "5000000000",
      useNativeETH:  true,
    });

    // Ainda tem 2 steps: approve mWETH + redeemETH
    expect(bundle.steps).toHaveLength(2);
    const decoded = decodeExecuteStep(bundle.steps[1].data);
    expect(decoded[1]).toBe(MOONWELL_SELECTORS.REDEEM_ETH);
  });

  it("metadata.useNativeETH é true para mWETH + useNativeETH=true", async () => {
    const { metadata } = await executePrepareRedeem({
      userAddress:   USER,
      mTokenAddress: M_WETH,
      amount:        "5000000000",
      useNativeETH:  true,
    });

    expect(metadata.useNativeETH).toBe(true);
  });

  it("useNativeETH ignorado se mercado não suporta ETH (mUSDC)", async () => {
    const { bundle, metadata } = await executePrepareRedeem({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "5000000000",
      useNativeETH:  true,
    });

    const decoded = decodeExecuteStep(bundle.steps[1].data);
    expect(decoded[1]).toBe(MOONWELL_SELECTORS.REDEEM);
    expect(metadata.useNativeETH).toBe(false);
  });
});
