import { describe, it, expect, vi } from "vitest";
import { ethers } from "ethers";

// ── Mocks (must precede imports) ──────────────────────────────────────────────

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

// ── Imports after mocks ───────────────────────────────────────────────────────

import { executePrepareSupply } from "../../../modules/moonwell-lending/usecases/prepare-supply.usecase";
import { MOONWELL_SELECTORS, PANORAMA_EXECUTOR_ABI_EXECUTE } from "../../../shared/bundle-builder";

const EXECUTOR = "0x1111111111111111111111111111111111111111";
const USER     = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const M_USDC   = "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22";
const M_WETH   = "0x628ff693426583D9a7FB391E54366292F509D457";
const USDC     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeExecuteStep(data: string) {
  const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
  return iface.decodeFunctionData("execute", data);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("moonwell-lending: prepare-supply (ERC20)", () => {
  it("retorna bundle com 2 steps: approve + supply", async () => {
    const { bundle } = await executePrepareSupply({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000", // 1000 USDC (6 decimals)
    });

    expect(bundle.steps).toHaveLength(2);
    expect(bundle.totalSteps).toBe(2);
  });

  it("step 0 é approve do underlying (USDC)", async () => {
    const { bundle } = await executePrepareSupply({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    const approveStep = bundle.steps[0];
    expect(approveStep.to.toLowerCase()).toBe(USDC.toLowerCase());
    expect(approveStep.chainId).toBe(8453);
  });

  it("step 1 é direcionado ao executor", async () => {
    const { bundle } = await executePrepareSupply({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    expect(bundle.steps[1].to.toLowerCase()).toBe(EXECUTOR.toLowerCase());
  });

  it("step 1 usa selector SUPPLY correto", async () => {
    const { bundle } = await executePrepareSupply({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    const decoded = decodeExecuteStep(bundle.steps[1].data);
    expect(decoded[1]).toBe(MOONWELL_SELECTORS.SUPPLY);
  });

  it("metadata.action é 'supply'", async () => {
    const { metadata } = await executePrepareSupply({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    expect(metadata.action).toBe("supply");
  });

  it("metadata.mTokenSymbol é 'mUSDC'", async () => {
    const { metadata } = await executePrepareSupply({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    expect(metadata.mTokenSymbol).toBe("mUSDC");
  });

  it("metadata.useNativeETH é false para USDC", async () => {
    const { metadata } = await executePrepareSupply({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    expect(metadata.useNativeETH).toBe(false);
  });

  it("chainId é 8453 (Base) em todos os steps", async () => {
    const { bundle } = await executePrepareSupply({
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
      executePrepareSupply({ userAddress: USER, mTokenAddress: M_USDC, amount: "0" })
    ).rejects.toThrow();
  });

  it("lança AppError para mToken desconhecido", async () => {
    await expect(
      executePrepareSupply({ userAddress: USER, mTokenAddress: "0x0000000000000000000000000000000000000001", amount: "1000" })
    ).rejects.toThrow();
  });
});

describe("moonwell-lending: prepare-supply (native ETH via supplyETH)", () => {
  it("retorna bundle com 1 step para supplyETH (sem approve)", async () => {
    const { bundle } = await executePrepareSupply({
      userAddress:   USER,
      mTokenAddress: M_WETH,
      amount:        "100000000000000000", // 0.1 ETH
      useNativeETH:  true,
    });

    expect(bundle.steps).toHaveLength(1);
  });

  it("step de supplyETH tem value igual ao amount", async () => {
    const amount = "100000000000000000";
    const { bundle } = await executePrepareSupply({
      userAddress:   USER,
      mTokenAddress: M_WETH,
      amount,
      useNativeETH:  true,
    });

    expect(bundle.steps[0].value).toBe(amount);
  });

  it("step de supplyETH usa selector SUPPLY_ETH", async () => {
    const { bundle } = await executePrepareSupply({
      userAddress:   USER,
      mTokenAddress: M_WETH,
      amount:        "100000000000000000",
      useNativeETH:  true,
    });

    const decoded = decodeExecuteStep(bundle.steps[0].data);
    expect(decoded[1]).toBe(MOONWELL_SELECTORS.SUPPLY_ETH);
  });

  it("useNativeETH ignorado se mercado não suporta ETH (USDC)", async () => {
    const { bundle, metadata } = await executePrepareSupply({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
      useNativeETH:  true, // mUSDC não suporta ETH variant
    });

    // Deve cair em ERC20 supply (2 steps: approve + supply)
    expect(bundle.steps).toHaveLength(2);
    expect(metadata.useNativeETH).toBe(false);
  });
});
