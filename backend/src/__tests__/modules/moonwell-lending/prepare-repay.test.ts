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

import { executePrepareRepay } from "../../../modules/moonwell-lending/usecases/prepare-repay.usecase";
import { MOONWELL_SELECTORS, PANORAMA_EXECUTOR_ABI_EXECUTE } from "../../../shared/bundle-builder";

const EXECUTOR = "0x1111111111111111111111111111111111111111";
const USER     = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const M_USDC   = "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22";
const M_WETH   = "0x628ff693426583D9a7FB391E54366292F509D457";
const USDC     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function decodeExecuteStep(data: string) {
  const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
  return iface.decodeFunctionData("execute", data);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("moonwell-lending: prepare-repay (ERC20)", () => {
  it("retorna bundle com 2 steps: approve underlying + repay", async () => {
    const { bundle } = await executePrepareRepay({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    expect(bundle.steps).toHaveLength(2);
    expect(bundle.totalSteps).toBe(2);
  });

  it("step 0 é approve do underlying (USDC), não do mToken", async () => {
    const { bundle } = await executePrepareRepay({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    // approve deve ser no underlying token (USDC), não no mToken
    expect(bundle.steps[0].to.toLowerCase()).toBe(USDC.toLowerCase());
  });

  it("step 1 é direcionado ao executor", async () => {
    const { bundle } = await executePrepareRepay({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    expect(bundle.steps[1].to.toLowerCase()).toBe(EXECUTOR.toLowerCase());
  });

  it("step 1 usa selector REPAY correto", async () => {
    const { bundle } = await executePrepareRepay({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    const decoded = decodeExecuteStep(bundle.steps[1].data);
    expect(decoded[1]).toBe(MOONWELL_SELECTORS.REPAY);
  });

  it("step 1 não envia value (repay ERC20)", async () => {
    const { bundle } = await executePrepareRepay({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    expect(bundle.steps[1].value).toBe("0");
  });

  it("metadata.action é 'repay'", async () => {
    const { metadata } = await executePrepareRepay({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    expect(metadata.action).toBe("repay");
  });

  it("metadata.mTokenSymbol é 'mUSDC'", async () => {
    const { metadata } = await executePrepareRepay({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    expect(metadata.mTokenSymbol).toBe("mUSDC");
  });

  it("metadata.useNativeETH é false para USDC", async () => {
    const { metadata } = await executePrepareRepay({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    expect(metadata.useNativeETH).toBe(false);
  });

  it("chainId é 8453 (Base) em todos os steps", async () => {
    const { bundle } = await executePrepareRepay({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    for (const step of bundle.steps) {
      expect(step.chainId).toBe(8453);
    }
  });

  it("lança AppError para amount zero", async () => {
    await expect(
      executePrepareRepay({ userAddress: USER, mTokenAddress: M_USDC, amount: "0" })
    ).rejects.toThrow();
  });

  it("lança AppError para mToken desconhecido", async () => {
    await expect(
      executePrepareRepay({
        userAddress:   USER,
        mTokenAddress: "0x0000000000000000000000000000000000000001",
        amount:        "1000",
      })
    ).rejects.toThrow();
  });
});

describe("moonwell-lending: prepare-repay (native ETH via repayETH)", () => {
  it("usa selector REPAY_ETH para mWETH com useNativeETH=true", async () => {
    const { bundle } = await executePrepareRepay({
      userAddress:   USER,
      mTokenAddress: M_WETH,
      amount:        "10000000000000000", // 0.01 ETH
      useNativeETH:  true,
    });

    // repayETH não precisa de approve (ETH nativo como value)
    expect(bundle.steps).toHaveLength(1);
    const decoded = decodeExecuteStep(bundle.steps[0].data);
    expect(decoded[1]).toBe(MOONWELL_SELECTORS.REPAY_ETH);
  });

  it("step de repayETH envia value igual ao amount", async () => {
    const amount = "10000000000000000";
    const { bundle } = await executePrepareRepay({
      userAddress:   USER,
      mTokenAddress: M_WETH,
      amount,
      useNativeETH:  true,
    });

    expect(bundle.steps[0].value).toBe(amount);
  });

  it("metadata.useNativeETH é true para mWETH + useNativeETH=true", async () => {
    const { metadata } = await executePrepareRepay({
      userAddress:   USER,
      mTokenAddress: M_WETH,
      amount:        "10000000000000000",
      useNativeETH:  true,
    });

    expect(metadata.useNativeETH).toBe(true);
  });

  it("useNativeETH ignorado se mercado não suporta ETH (mUSDC)", async () => {
    const { bundle, metadata } = await executePrepareRepay({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
      useNativeETH:  true,
    });

    // Deve cair em ERC20 repay (2 steps: approve + repay)
    expect(bundle.steps).toHaveLength(2);
    const decoded = decodeExecuteStep(bundle.steps[1].data);
    expect(decoded[1]).toBe(MOONWELL_SELECTORS.REPAY);
    expect(metadata.useNativeETH).toBe(false);
  });
});
