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
  getContract: vi.fn(() => ({})),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { executePrepareBorrow } from "../../../modules/moonwell-lending/usecases/prepare-borrow.usecase";
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

describe("moonwell-lending: prepare-borrow (ERC20)", () => {
  it("retorna bundle com 1 step (borrow não precisa de approve)", async () => {
    const { bundle } = await executePrepareBorrow({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    expect(bundle.steps).toHaveLength(1);
  });

  it("step é direcionado ao executor", async () => {
    const { bundle } = await executePrepareBorrow({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    expect(bundle.steps[0].to.toLowerCase()).toBe(EXECUTOR.toLowerCase());
  });

  it("step usa selector BORROW correto", async () => {
    const { bundle } = await executePrepareBorrow({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    const decoded = decodeExecuteStep(bundle.steps[0].data);
    expect(decoded[1]).toBe(MOONWELL_SELECTORS.BORROW);
  });

  it("step não envia value (borrow ERC20)", async () => {
    const { bundle } = await executePrepareBorrow({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    expect(bundle.steps[0].value).toBe("0");
  });

  it("metadata.action é 'borrow'", async () => {
    const { metadata } = await executePrepareBorrow({
      userAddress:   USER,
      mTokenAddress: M_USDC,
      amount:        "1000000000",
    });

    expect(metadata.action).toBe("borrow");
  });

  it("lança AppError para amount zero", async () => {
    await expect(
      executePrepareBorrow({ userAddress: USER, mTokenAddress: M_USDC, amount: "0" })
    ).rejects.toThrow();
  });
});

describe("moonwell-lending: prepare-borrow (native ETH via borrowETH)", () => {
  it("usa selector BORROW_ETH para mWETH com useNativeETH", async () => {
    const { bundle } = await executePrepareBorrow({
      userAddress:   USER,
      mTokenAddress: M_WETH,
      amount:        "10000000000000000", // 0.01 ETH
      useNativeETH:  true,
    });

    const decoded = decodeExecuteStep(bundle.steps[0].data);
    expect(decoded[1]).toBe(MOONWELL_SELECTORS.BORROW_ETH);
  });

  it("metadata.useNativeETH é true para mWETH + useNativeETH=true", async () => {
    const { metadata } = await executePrepareBorrow({
      userAddress:   USER,
      mTokenAddress: M_WETH,
      amount:        "10000000000000000",
      useNativeETH:  true,
    });

    expect(metadata.useNativeETH).toBe(true);
  });
});
