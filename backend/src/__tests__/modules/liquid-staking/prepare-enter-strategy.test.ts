import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";

const EXECUTOR    = "0x82b000512A19f7B762A23033aEA5AE00aBD0D2bC";
const POOL_ADDR   = "0xcDAC0d6c6C59727a65F871236188350531885C43";
const GAUGE_ADDR  = "0x519BBD1Dd8C6A94C46080E24f316c14Ee758C025";
const TOKEN_A     = "0x4200000000000000000000000000000000000006"; // WETH
const TOKEN_B     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC
const USER        = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

vi.mock("../../../config/chains", () => ({
  getChainConfig: vi.fn(() => ({
    chainId: 8453,
    contracts: { panoramaExecutor: EXECUTOR },
  })),
}));

vi.mock("../../../shared/services/aerodrome.service", () => ({
  aerodromeService: {
    resolvePoolAndGauge: vi.fn(),
    checkAllowance: vi.fn(),
    quoteAddLiquidity: vi.fn(),
    withRetry: vi.fn(<T>(fn: () => Promise<T>) => fn()),
  },
}));

vi.mock("../../../providers/chain.provider", () => ({
  getContract: vi.fn(() => ({
    balanceOf: vi.fn().mockResolvedValue(10_000n),
  })),
}));

vi.mock("../../../modules/liquid-staking/config/staking-pools", () => ({
  getStakingPoolById: vi.fn((id: string) => {
    if (id === "weth-usdc-volatile") {
      return {
        id: "weth-usdc-volatile",
        name: "WETH/USDC Volatile",
        poolAddress: POOL_ADDR,
        gaugeAddress: GAUGE_ADDR,
        tokenA: { symbol: "WETH", address: TOKEN_A, decimals: 18 },
        tokenB: { symbol: "USDC", address: TOKEN_B, decimals: 6 },
        stable: false,
        rewardToken: { symbol: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
        enabled: true,
      };
    }
    return null;
  }),
}));

import { aerodromeService } from "../../../shared/services/aerodrome.service";
import { executeEnterStrategy } from "../../../modules/liquid-staking/usecases/prepare-enter-strategy.usecase";
import { PANORAMA_EXECUTOR_ABI_EXECUTE, ADAPTER_SELECTORS } from "../../../shared/bundle-builder";

const mockResolve     = vi.mocked(aerodromeService.resolvePoolAndGauge);
const mockAllowance   = vi.mocked(aerodromeService.checkAllowance);
const mockQuote       = vi.mocked(aerodromeService.quoteAddLiquidity);
const mockWithRetry   = vi.mocked(aerodromeService.withRetry);

describe("executeEnterStrategy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockResolvedValue({ poolAddress: POOL_ADDR, gaugeAddress: GAUGE_ADDR });
    mockAllowance.mockResolvedValue({ allowance: 0n, sufficient: false });
    mockQuote.mockResolvedValue({ optimalA: 1000n, optimalB: 2000n, estimatedLiquidity: 500n });
    // Make withRetry just call the function directly
    mockWithRetry.mockImplementation(<T>(fn: () => Promise<T>) => fn());
  });

  it("throws when pool not found", async () => {
    await expect(
      executeEnterStrategy({ userAddress: USER, poolId: "nonexistent", amountA: "1000", amountB: "2000" })
    ).rejects.toThrow("Staking pool not found");
  });

  it("throws when estimated liquidity is 0", async () => {
    mockQuote.mockResolvedValue({ optimalA: 0n, optimalB: 0n, estimatedLiquidity: 0n });
    await expect(
      executeEnterStrategy({ userAddress: USER, poolId: "weth-usdc-volatile", amountA: "1", amountB: "1" })
    ).rejects.toThrow("Cannot add liquidity");
  });

  it("bundle includes approve tokenA, approve tokenB, addLiquidity, approve LP, stake", async () => {
    const { bundle } = await executeEnterStrategy({
      userAddress: USER, poolId: "weth-usdc-volatile", amountA: "1000", amountB: "2000",
    });
    // 2 approves (tokenA, tokenB) + addLiquidity + approve LP + stake = 5 steps
    expect(bundle.steps).toHaveLength(5);
  });

  it("skips approve tokenA when allowance sufficient", async () => {
    mockAllowance.mockImplementation(async (token) => {
      if (token === TOKEN_A) return { allowance: 99999n, sufficient: true };
      return { allowance: 0n, sufficient: false };
    });
    const { bundle } = await executeEnterStrategy({
      userAddress: USER, poolId: "weth-usdc-volatile", amountA: "1000", amountB: "2000",
    });
    // tokenA approve skipped → 4 steps
    expect(bundle.steps).toHaveLength(4);
  });

  it("addLiquidity step uses ADD_LIQUIDITY selector", async () => {
    const { bundle } = await executeEnterStrategy({
      userAddress: USER, poolId: "weth-usdc-volatile", amountA: "1000", amountB: "2000",
    });
    // addLiquidity is the 3rd step (after 2 approves)
    const addLiqStep = bundle.steps[2];
    const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
    const decoded = iface.decodeFunctionData("execute", addLiqStep.data);
    expect(decoded[1]).toBe(ADAPTER_SELECTORS.ADD_LIQUIDITY);
  });

  it("stake step uses STAKE selector", async () => {
    const { bundle } = await executeEnterStrategy({
      userAddress: USER, poolId: "weth-usdc-volatile", amountA: "1000", amountB: "2000",
    });
    const stakeStep = bundle.steps[bundle.steps.length - 1];
    const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
    const decoded = iface.decodeFunctionData("execute", stakeStep.data);
    expect(decoded[1]).toBe(ADAPTER_SELECTORS.STAKE);
  });

  it("stake step has LP token in transfers", async () => {
    const { bundle } = await executeEnterStrategy({
      userAddress: USER, poolId: "weth-usdc-volatile", amountA: "1000", amountB: "2000",
    });
    const stakeStep = bundle.steps[bundle.steps.length - 1];
    const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
    const decoded = iface.decodeFunctionData("execute", stakeStep.data);
    expect(decoded[2][0].token).toBe(POOL_ADDR);
  });

  it("metadata contains poolAddress, gaugeAddress, stable", async () => {
    const { metadata } = await executeEnterStrategy({
      userAddress: USER, poolId: "weth-usdc-volatile", amountA: "1000", amountB: "2000",
    });
    expect(metadata.poolAddress).toBe(POOL_ADDR);
    expect(metadata.gaugeAddress).toBe(GAUGE_ADDR);
    expect(metadata.stable).toBe(false);
  });

  it("metadata estimatedLiquidity matches quoteAddLiquidity result", async () => {
    const { metadata } = await executeEnterStrategy({
      userAddress: USER, poolId: "weth-usdc-volatile", amountA: "1000", amountB: "2000",
    });
    expect(metadata.estimatedLiquidity).toBe("500");
  });

  it("bundle summary mentions pool name", async () => {
    const { bundle } = await executeEnterStrategy({
      userAddress: USER, poolId: "weth-usdc-volatile", amountA: "1000", amountB: "2000",
    });
    expect(bundle.summary).toContain("WETH/USDC Volatile");
  });
});
