import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";

const EXECUTOR = "0x82b000512A19f7B762A23033aEA5AE00aBD0D2bC";

vi.mock("../../../config/chains", () => ({
  getChainConfig: vi.fn(() => ({
    chainId: 8453,
    name: "Base",
    contracts: { panoramaExecutor: EXECUTOR },
  })),
}));

vi.mock("../../../shared/services/aerodrome.service", () => ({
  aerodromeService: {
    getQuote: vi.fn(),
    checkAllowance: vi.fn(),
  },
}));

import { aerodromeService } from "../../../shared/services/aerodrome.service";
import { executePrepareSwapBundle } from "../../../modules/swap/usecases/prepare-swap.usecase";
import { ADAPTER_SELECTORS, PANORAMA_EXECUTOR_ABI_EXECUTE } from "../../../shared/bundle-builder";

const mockGetQuote      = vi.mocked(aerodromeService.getQuote);
const mockCheckAllowance = vi.mocked(aerodromeService.checkAllowance);

const TOKEN_IN  = "0x4200000000000000000000000000000000000006"; // WETH
const TOKEN_OUT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC
const USER      = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ETH_ADDR  = "0x0000000000000000000000000000000000000000";

describe("executePrepareSwapBundle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetQuote.mockResolvedValue({ amountOut: 2000n, route: [] });
    mockCheckAllowance.mockResolvedValue({ allowance: 0n, sufficient: false });
  });

  it("includes approve step when allowance is insufficient", async () => {
    mockCheckAllowance.mockResolvedValue({ allowance: 0n, sufficient: false });
    const { bundle } = await executePrepareSwapBundle({
      userAddress: USER, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "1000",
    });
    expect(bundle.steps).toHaveLength(2); // approve + execute
    expect(bundle.steps[0].to).toBe(TOKEN_IN);
  });

  it("skips approve step when allowance is sufficient", async () => {
    mockCheckAllowance.mockResolvedValue({ allowance: 99999n, sufficient: true });
    const { bundle } = await executePrepareSwapBundle({
      userAddress: USER, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "1000",
    });
    expect(bundle.steps).toHaveLength(1); // only execute
    expect(bundle.steps[0].to).toBe(EXECUTOR);
  });

  it("execute step goes to executor address", async () => {
    const { bundle } = await executePrepareSwapBundle({
      userAddress: USER, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "1000",
    });
    const execStep = bundle.steps[bundle.steps.length - 1];
    expect(execStep.to).toBe(EXECUTOR);
  });

  it("uses SWAP selector in calldata", async () => {
    const { bundle } = await executePrepareSwapBundle({
      userAddress: USER, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "1000",
    });
    const execStep = bundle.steps[bundle.steps.length - 1];
    const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
    const decoded = iface.decodeFunctionData("execute", execStep.data);
    expect(decoded[1]).toBe(ADAPTER_SELECTORS.SWAP);
  });

  it("metadata contains amountOut and amountOutMin", async () => {
    const { metadata } = await executePrepareSwapBundle({
      userAddress: USER, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "1000",
    });
    expect(metadata.amountOut).toBe("2000");
    // default 50bps: 2000 * 9950 / 10000 = 1990
    expect(metadata.amountOutMin).toBe("1990");
  });

  it("ETH swap sets ethValue and skips approve", async () => {
    const { bundle } = await executePrepareSwapBundle({
      userAddress: USER, tokenIn: ETH_ADDR, tokenOut: TOKEN_OUT, amountIn: "5000",
    });
    expect(bundle.steps).toHaveLength(1); // no approve for ETH
    expect(bundle.steps[0].value).toBe("5000");
    expect(mockCheckAllowance).not.toHaveBeenCalled();
  });

  it("ETH swap has empty transfers array in calldata", async () => {
    const { bundle } = await executePrepareSwapBundle({
      userAddress: USER, tokenIn: ETH_ADDR, tokenOut: TOKEN_OUT, amountIn: "5000",
    });
    const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
    const decoded = iface.decodeFunctionData("execute", bundle.steps[0].data);
    expect(decoded[2]).toHaveLength(0); // transfers = []
  });

  it("ERC-20 swap has token transfer in calldata", async () => {
    const { bundle } = await executePrepareSwapBundle({
      userAddress: USER, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "1000",
    });
    const execStep = bundle.steps[bundle.steps.length - 1];
    const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
    const decoded = iface.decodeFunctionData("execute", execStep.data);
    expect(decoded[2][0].token).toBe(TOKEN_IN);
    expect(decoded[2][0].amount).toBe(1000n);
  });

  it("checkAllowance called with executor as spender", async () => {
    await executePrepareSwapBundle({
      userAddress: USER, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "1000",
    });
    expect(mockCheckAllowance).toHaveBeenCalledWith(TOKEN_IN, USER, EXECUTOR, 1000n);
  });

  it("bundle summary mentions stable or volatile", async () => {
    const { bundle } = await executePrepareSwapBundle({
      userAddress: USER, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "1000", stable: true,
    });
    expect(bundle.summary).toContain("stable");
  });

  it("metadata priceImpact is a numeric string", async () => {
    const { metadata } = await executePrepareSwapBundle({
      userAddress: USER, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "1000",
    });
    expect(isNaN(Number(metadata.priceImpact))).toBe(false);
  });
});
