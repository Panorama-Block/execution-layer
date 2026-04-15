import { describe, it, expect, vi } from "vitest";
import { ethers } from "ethers";

// ── Mocks (devem preceder os imports) ────────────────────────────────────────

vi.mock("../../../config/chains", () => ({
  getChainConfig: vi.fn(() => ({
    chainId: 43114,
    name: "Avalanche C-Chain",
    contracts: { panoramaExecutor: "0x1111111111111111111111111111111111111111" },
  })),
}));

vi.mock("../../../providers/chain.provider", () => ({
  getProvider: vi.fn(() => ({
    estimateGas: vi.fn().mockResolvedValue(100000n),
    getFeeData:  vi.fn().mockResolvedValue({ gasPrice: 25000000000n }),
  })),
  getContract: vi.fn(() => ({})),
}));

// ── Imports após mocks ────────────────────────────────────────────────────────

import { executePrepareStake } from "../../../modules/avax-liquid-staking/usecases/prepare-stake.usecase";
import { SAVAX_SELECTORS, PANORAMA_EXECUTOR_ABI_EXECUTE } from "../../../shared/bundle-builder";

const EXECUTOR = "0x1111111111111111111111111111111111111111";
const USER     = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeExecuteStep(data: string) {
  const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
  return iface.decodeFunctionData("execute", data);
}

// ── Testes ────────────────────────────────────────────────────────────────────

describe("avax-liquid-staking: prepare-stake", () => {
  it("retorna bundle com 1 step (stake nativo, sem approve de ERC-20)", async () => {
    const { bundle } = await executePrepareStake({
      userAddress: USER,
      amount: "1000000000000000000",
    });

    expect(bundle.steps).toHaveLength(1);
    expect(bundle.totalSteps).toBe(1);
  });

  it("o step de stake envia AVAX como msg.value (não zero)", async () => {
    const { bundle } = await executePrepareStake({
      userAddress: USER,
      amount: "1000000000000000000",
    });

    expect(bundle.steps[0].value).toBe("1000000000000000000");
  });

  it("o step de stake é direcionado ao executor", async () => {
    const { bundle } = await executePrepareStake({
      userAddress: USER,
      amount: "500000000000000000",
    });

    expect(bundle.steps[0].to.toLowerCase()).toBe(EXECUTOR.toLowerCase());
  });

  it("calldata usa o selector STAKE correto", async () => {
    const { bundle } = await executePrepareStake({
      userAddress: USER,
      amount: "1000000000000000000",
    });

    const decoded = decodeExecuteStep(bundle.steps[0].data);
    expect(decoded[1]).toBe(SAVAX_SELECTORS.STAKE);
  });

  it("o array de transfers está vazio (AVAX nativo, sem pull ERC-20)", async () => {
    const { bundle } = await executePrepareStake({
      userAddress: USER,
      amount: "1000000000000000000",
    });

    const decoded = decodeExecuteStep(bundle.steps[0].data);
    expect(decoded[2]).toHaveLength(0); // transfers = []
  });

  it("chainId é 43114 (Avalanche) em todos os steps", async () => {
    const { bundle } = await executePrepareStake({
      userAddress: USER,
      amount: "2000000000000000000",
    });

    for (const step of bundle.steps) {
      expect(step.chainId).toBe(43114);
    }
  });

  it("metadata.action é 'stake'", async () => {
    const { metadata } = await executePrepareStake({
      userAddress: USER,
      amount: "1000000000000000000",
    });

    expect(metadata.action).toBe("stake");
  });

  it("metadata.avaxAmount reflete o amount enviado", async () => {
    const { metadata } = await executePrepareStake({
      userAddress: USER,
      amount: "750000000000000000",
    });

    expect(metadata.avaxAmount).toBe("750000000000000000");
  });

  it("lança AppError para amount zero", async () => {
    await expect(
      executePrepareStake({ userAddress: USER, amount: "0" })
    ).rejects.toThrow();
  });

  it("lança AppError para amount negativo (string inválida como bigint)", async () => {
    await expect(
      executePrepareStake({ userAddress: USER, amount: "-1" })
    ).rejects.toThrow();
  });
});
