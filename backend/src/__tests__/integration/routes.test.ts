/**
 * Integration tests — verifies that all active route handlers produce
 * well-formed TransactionBundle responses after a full usecase execution.
 *
 * Strategy: mock only the on-chain service layer (AerodromeService + staking pool config)
 * and call the usecase functions directly. This exercises the full pipeline:
 *   route params → usecase → BundleBuilder → TransactionBundle
 * without spinning up an HTTP server or touching the blockchain.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";

// ── Constants ─────────────────────────────────────────────────────────────────

const EXECUTOR  = "0x79D671250f75631ca199d0Fa22b0071052214172";
const USER      = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const WETH      = "0x4200000000000000000000000000000000000006";
const USDC      = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const POOL_ADDR = "0xcDAC0d6c6C59727a65F871236188350531885C43";
const GAUGE     = "0x519BBD1Dd8C6A94C46080E24f316c14Ee758C025";
const AERO      = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const ETH_ADDR  = "0x0000000000000000000000000000000000000000";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../config/chains", () => ({
  getChainConfig: vi.fn(() => ({
    chainId: 8453,
    name: "Base",
    contracts: { panoramaExecutor: EXECUTOR },
  })),
}));

vi.mock("../../shared/services/aerodrome.service", () => ({
  aerodromeService: {
    getQuote:           vi.fn(),
    checkAllowance:     vi.fn(),
    resolvePoolAndGauge: vi.fn(),
    getUserAdapterAddress: vi.fn(),
    getStakedBalance:   vi.fn(),
    getEarnedRewards:   vi.fn(),
    getTokenBalance:    vi.fn(),
    quoteAddLiquidity:  vi.fn(),
    withRetry:          vi.fn((fn: () => Promise<unknown>) => fn()),
    withTimeout:        vi.fn((fn: () => Promise<unknown>) => fn()),
  },
}));

const { mockGetStakingPoolById, mockBalanceOf } = vi.hoisted(() => ({
  mockGetStakingPoolById: vi.fn(() => ({
    id: "weth-usdc-volatile",
    name: "WETH/USDC Volatile",
    stable: false,
    poolAddress: "0xcDAC0d6c6C59727a65F871236188350531885C43",
    gaugeAddress: "0x519BBD1Dd8C6A94C46080E24f316c14Ee758C025",
    tokenA: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    tokenB: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6  },
    rewardToken: { symbol: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
  })),
  mockBalanceOf: vi.fn().mockResolvedValue(BigInt("10000000000000000000")),
}));

vi.mock("../../modules/liquid-staking/config/staking-pools", () => ({
  getStakingPoolById: mockGetStakingPoolById,
}));

// Prevent real chain calls from getContract
vi.mock("../../providers/chain.provider", () => ({
  getContract: vi.fn(() => ({ balanceOf: mockBalanceOf })),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { aerodromeService } from "../../shared/services/aerodrome.service";
import { executePrepareSwapBundle } from "../../modules/swap/usecases/prepare-swap.usecase";
import { executeEnterStrategy }     from "../../modules/liquid-staking/usecases/prepare-enter-strategy.usecase";
import { executeExitStrategy }      from "../../modules/liquid-staking/usecases/prepare-exit-strategy.usecase";
import { executeClaimRewards }      from "../../modules/liquid-staking/usecases/prepare-claim-rewards.usecase";
import { ADAPTER_SELECTORS, PANORAMA_EXECUTOR_ABI_EXECUTE } from "../../shared/bundle-builder";

const mockService = vi.mocked(aerodromeService);

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeExecuteStep(data: string) {
  const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
  return iface.decodeFunctionData("execute", data);
}

function isApproveStep(to: string, step: { to: string }) {
  return step.to.toLowerCase() === to.toLowerCase();
}

// ── /swap/prepare ─────────────────────────────────────────────────────────────

describe("/swap/prepare — executePrepareSwapBundle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService.getQuote.mockResolvedValue({ amountOut: 3000n, route: [] });
    mockService.checkAllowance.mockResolvedValue({ allowance: 0n, sufficient: false });
    mockService.getTokenBalance.mockResolvedValue(10000000000000000000n);
  });

  it("returns a bundle with approve + execute steps for ERC-20 swap", async () => {
    const { bundle, metadata } = await executePrepareSwapBundle({
      userAddress: USER, tokenIn: WETH, tokenOut: USDC, amountIn: "1000000000000000000",
    });

    expect(bundle.steps).toHaveLength(2);
    expect(bundle.totalSteps).toBe(2);

    // Step 0: approve
    expect(bundle.steps[0].to.toLowerCase()).toBe(WETH.toLowerCase());
    expect(bundle.steps[0].value).toBe("0");

    // Step 1: execute swap
    expect(bundle.steps[1].to.toLowerCase()).toBe(EXECUTOR.toLowerCase());
    const decoded = decodeExecuteStep(bundle.steps[1].data);
    expect(decoded[1]).toBe(ADAPTER_SELECTORS.SWAP);

    // Metadata
    expect(metadata.amountOut).toBe("3000");
    expect(typeof metadata.amountOutMin).toBe("string");
    expect(metadata.tokenIn).toBe(WETH);
    expect(metadata.tokenOut).toBe(USDC);
  });

  it("skips approve step when allowance is already sufficient", async () => {
    mockService.checkAllowance.mockResolvedValue({ allowance: 99999999n, sufficient: true });
    const { bundle } = await executePrepareSwapBundle({
      userAddress: USER, tokenIn: WETH, tokenOut: USDC, amountIn: "1000",
    });
    expect(bundle.steps).toHaveLength(1);
    expect(bundle.steps[0].to.toLowerCase()).toBe(EXECUTOR.toLowerCase());
  });

  it("ETH swap: no approve, non-zero value on execute step", async () => {
    const { bundle } = await executePrepareSwapBundle({
      userAddress: USER, tokenIn: ETH_ADDR, tokenOut: USDC, amountIn: "500000000000000000",
    });
    expect(bundle.steps).toHaveLength(1);
    expect(bundle.steps[0].value).toBe("500000000000000000");
    expect(mockService.checkAllowance).not.toHaveBeenCalled();
  });

  it("execute step uses SWAP selector", async () => {
    const { bundle } = await executePrepareSwapBundle({
      userAddress: USER, tokenIn: WETH, tokenOut: USDC, amountIn: "1000",
    });
    const execStep = bundle.steps[bundle.steps.length - 1];
    const decoded  = decodeExecuteStep(execStep.data);
    expect(decoded[1]).toBe(ADAPTER_SELECTORS.SWAP);
  });

  it("execute step transfers array contains tokenIn", async () => {
    const { bundle } = await executePrepareSwapBundle({
      userAddress: USER, tokenIn: WETH, tokenOut: USDC, amountIn: "1000",
    });
    const execStep = bundle.steps[bundle.steps.length - 1];
    const decoded  = decodeExecuteStep(execStep.data);
    expect(decoded[2][0].token.toLowerCase()).toBe(WETH.toLowerCase());
  });

  it("chainId is 8453 on all steps", async () => {
    const { bundle } = await executePrepareSwapBundle({
      userAddress: USER, tokenIn: WETH, tokenOut: USDC, amountIn: "1000",
    });
    for (const step of bundle.steps) {
      expect(step.chainId).toBe(8453);
    }
  });
});

// ── /staking/prepare-enter ────────────────────────────────────────────────────

describe("/staking/prepare-enter — executeEnterStrategy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService.resolvePoolAndGauge.mockResolvedValue({ poolAddress: POOL_ADDR, gaugeAddress: GAUGE });
    mockService.quoteAddLiquidity.mockResolvedValue({
      optimalA: 1000000000000000000n,
      optimalB: 3000000n,
      estimatedLiquidity: 1000000n,
    });
    mockService.checkAllowance.mockResolvedValue({ allowance: 0n, sufficient: false });
    mockService.withRetry.mockImplementation((fn: () => Promise<unknown>) => fn());
    mockBalanceOf.mockResolvedValue(BigInt("10000000000000000000"));
  });

  it("returns a bundle with approvals + addLiquidity + LP approve + stake", async () => {
    const { bundle, metadata } = await executeEnterStrategy({
      userAddress: USER,
      poolId: "weth-usdc-volatile",
      amountA: "1000000000000000000",
      amountB: "3000000",
    });

    // Must have at least 3 steps: approve A, approve B, addLiquidity (+ optionally LP approve + stake)
    expect(bundle.steps.length).toBeGreaterThanOrEqual(3);
    expect(bundle.totalSteps).toBe(bundle.steps.length);

    // addLiquidity step uses ADD_LIQUIDITY selector
    const addLiqStep = bundle.steps.find((s) => s.to.toLowerCase() === EXECUTOR.toLowerCase() &&
      decodeExecuteStep(s.data)[1] === ADAPTER_SELECTORS.ADD_LIQUIDITY
    );
    expect(addLiqStep).toBeDefined();

    // Metadata
    expect(metadata.poolAddress).toBe(POOL_ADDR);
    expect(metadata.gaugeAddress).toBe(GAUGE);
    expect(metadata.tokenA.symbol).toBe("WETH");
  });

  it("stake step uses STAKE selector", async () => {
    const { bundle } = await executeEnterStrategy({
      userAddress: USER,
      poolId: "weth-usdc-volatile",
      amountA: "1000000000000000000",
      amountB: "3000000",
    });

    const stakeStep = bundle.steps.find((s) => s.to.toLowerCase() === EXECUTOR.toLowerCase() &&
      decodeExecuteStep(s.data)[1] === ADAPTER_SELECTORS.STAKE
    );
    expect(stakeStep).toBeDefined();
  });

  it("throws when poolId is unknown", async () => {
    mockGetStakingPoolById.mockReturnValueOnce(null as any);

    await expect(
      executeEnterStrategy({ userAddress: USER, poolId: "nonexistent", amountA: "1", amountB: "1" })
    ).rejects.toThrow("Staking pool not found");
  });
});

// ── /staking/prepare-exit ─────────────────────────────────────────────────────

describe("/staking/prepare-exit — executeExitStrategy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService.resolvePoolAndGauge.mockResolvedValue({ poolAddress: POOL_ADDR, gaugeAddress: GAUGE });
    mockService.getUserAdapterAddress.mockResolvedValue("0x000000000000000000000000000000000000dEaD");
    mockService.getStakedBalance.mockResolvedValue(500000n);
    mockService.getTokenBalance.mockResolvedValue(0n);
    mockService.checkAllowance.mockResolvedValue({ allowance: 0n, sufficient: false });
  });

  it("returns a bundle with unstake + approve LP + removeLiquidity", async () => {
    const { bundle, metadata } = await executeExitStrategy({
      userAddress: USER, poolId: "weth-usdc-volatile",
    });

    expect(bundle.steps.length).toBeGreaterThanOrEqual(2);
    expect(bundle.totalSteps).toBe(bundle.steps.length);

    // Unstake step
    const unstakeStep = bundle.steps.find((s) => s.to.toLowerCase() === EXECUTOR.toLowerCase() &&
      decodeExecuteStep(s.data)[1] === ADAPTER_SELECTORS.UNSTAKE
    );
    expect(unstakeStep).toBeDefined();

    // RemoveLiquidity step
    const removeStep = bundle.steps.find((s) => s.to.toLowerCase() === EXECUTOR.toLowerCase() &&
      decodeExecuteStep(s.data)[1] === ADAPTER_SELECTORS.REMOVE_LIQUIDITY
    );
    expect(removeStep).toBeDefined();

    expect(metadata.poolAddress).toBe(POOL_ADDR);
  });

  it("throws when there is no LP position", async () => {
    mockService.getStakedBalance.mockResolvedValue(0n);
    mockService.getTokenBalance.mockResolvedValue(0n);

    await expect(
      executeExitStrategy({ userAddress: USER, poolId: "weth-usdc-volatile" })
    ).rejects.toThrow("No LP position");
  });
});

// ── /staking/prepare-claim ────────────────────────────────────────────────────

describe("/staking/prepare-claim — executeClaimRewards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService.resolvePoolAndGauge.mockResolvedValue({ poolAddress: POOL_ADDR, gaugeAddress: GAUGE });
    mockService.getUserAdapterAddress.mockResolvedValue("0x000000000000000000000000000000000000dEaD");
    mockService.getEarnedRewards.mockResolvedValue(100000000000000000n); // 0.1 AERO
  });

  it("returns a single-step bundle with CLAIM_REWARDS selector", async () => {
    const { bundle, metadata } = await executeClaimRewards({
      userAddress: USER, poolId: "weth-usdc-volatile",
    });

    expect(bundle.steps).toHaveLength(1);
    expect(bundle.totalSteps).toBe(1);

    const decoded = decodeExecuteStep(bundle.steps[0].data);
    expect(decoded[1]).toBe(ADAPTER_SELECTORS.CLAIM_REWARDS);
    expect(bundle.steps[0].value).toBe("0");

    expect(metadata.gaugeAddress).toBe(GAUGE);
    expect(metadata.earnedRewards).toBe("100000000000000000");
    expect(metadata.rewardToken.symbol).toBe("AERO");
  });

  it("throws when there are no rewards to claim", async () => {
    mockService.getEarnedRewards.mockResolvedValue(0n);
    await expect(
      executeClaimRewards({ userAddress: USER, poolId: "weth-usdc-volatile" })
    ).rejects.toThrow("No rewards");
  });
});

// ── Bundle structure invariants ───────────────────────────────────────────────

describe("Bundle structure invariants (all routes)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService.getQuote.mockResolvedValue({ amountOut: 1000n, route: [] });
    mockService.checkAllowance.mockResolvedValue({ allowance: 99999n, sufficient: true });
    mockService.getTokenBalance.mockResolvedValue(999999n);
  });

  it("every execute step targets the executor address", async () => {
    const { bundle } = await executePrepareSwapBundle({
      userAddress: USER, tokenIn: WETH, tokenOut: USDC, amountIn: "1000",
    });
    for (const step of bundle.steps) {
      if (step.to.toLowerCase() !== WETH.toLowerCase()) {
        expect(step.to.toLowerCase()).toBe(EXECUTOR.toLowerCase());
      }
    }
  });

  it("every step has a chainId of 8453", async () => {
    const { bundle } = await executePrepareSwapBundle({
      userAddress: USER, tokenIn: WETH, tokenOut: USDC, amountIn: "1000",
    });
    for (const step of bundle.steps) {
      expect(step.chainId).toBe(8453);
    }
  });

  it("every execute step's calldata decodes against the EXECUTE ABI", async () => {
    const { bundle } = await executePrepareSwapBundle({
      userAddress: USER, tokenIn: WETH, tokenOut: USDC, amountIn: "1000",
    });
    const execSteps = bundle.steps.filter((s) => s.to.toLowerCase() === EXECUTOR.toLowerCase());
    const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
    for (const step of execSteps) {
      expect(() => iface.decodeFunctionData("execute", step.data)).not.toThrow();
    }
  });
});
