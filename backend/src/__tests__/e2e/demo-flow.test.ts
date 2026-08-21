/**
 * E2E Demo Flow — H5 canonical path
 *
 * Simulates the full user journey 10+ times:
 *   1. Quote swap (WETH → USDC)
 *   2. Prepare swap bundle
 *   3. Check portfolio (empty)
 *   4. Enter staking position (add liquidity + stake)
 *   5. Check portfolio (has position)
 *   6. Claim rewards
 *   7. Exit position (unstake + remove liquidity)
 *   8. Check portfolio (empty again)
 *
 * Tests cover:
 *   - Deterministic output across repeated runs
 *   - Fallback messaging for common failures (RPC timeout, insufficient balance, pool not found)
 *   - Bundle structure invariants
 *   - Flaky path detection via iteration
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";

// ── Constants ─────────────────────────────────────────────────────────────────

const EXECUTOR  = "0x7528861E7DD09dc9B1e5149542e897d984Ceda7f";
const USER      = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const WETH      = "0x4200000000000000000000000000000000000006";
const USDC      = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const AERO      = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const POOL_ADDR = "0xcDAC0d6c6C59727a65F871236188350531885C43";
const GAUGE     = "0x519BBD1Dd8C6A94C46080E24f316c14Ee758C025";
const ETH_ADDR  = "0x0000000000000000000000000000000000000000";
const ADAPTER   = "0x000000000000000000000000000000000000dEaD";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../config/chains", () => ({
  getChainConfig: vi.fn(() => ({
    chainId: 8453,
    name: "Base",
    contracts: { panoramaExecutor: EXECUTOR },
  })),
}));

const { mockBalanceOf, mockGetReserves, mockTotalSupply, mockToken0 } = vi.hoisted(() => ({
  mockBalanceOf:    vi.fn().mockResolvedValue(BigInt("10000000000000000000")),
  mockGetReserves:  vi.fn().mockResolvedValue([1_000_000_000_000_000_000n, 3_000_000_000n, 0n]),
  mockTotalSupply:  vi.fn().mockResolvedValue(1_000_000_000n),
  mockToken0:       vi.fn().mockResolvedValue("0x4200000000000000000000000000000000000006"),
}));

vi.mock("../../providers/chain.provider", () => ({
  getProvider: vi.fn(() => ({
    estimateGas: vi.fn().mockResolvedValue(100_000n),
  })),
  getContract: vi.fn(() => ({
    balanceOf:    mockBalanceOf,
    getReserves:  mockGetReserves,
    totalSupply:  mockTotalSupply,
    token0:       mockToken0,
  })),
}));

vi.mock("../../shared/services/aerodrome.service", () => ({
  aerodromeService: {
    getQuote:              vi.fn(),
    checkAllowance:        vi.fn(),
    getTokenBalance:       vi.fn(),
    resolvePoolAndGauge:   vi.fn(),
    getUserAdapterAddress: vi.fn(),
    getStakedBalance:      vi.fn(),
    getEarnedRewards:      vi.fn(),
    quoteAddLiquidity:     vi.fn(),
    getWalletBalanceCached: vi.fn().mockReturnValue(null),
    setWalletBalanceCached: vi.fn(),
    withRetry:             vi.fn((fn: () => Promise<unknown>) => fn()),
    withTimeout:           vi.fn((fn: () => Promise<unknown>) => fn()),
  },
}));

vi.mock("../../utils/tokenMath", async () => {
  const actual = await vi.importActual<typeof import("../../utils/tokenMath")>("../../utils/tokenMath");
  return {
    ...actual,
    getTokenDecimals: vi.fn().mockResolvedValue(18),
  };
});

vi.mock("../../modules/liquid-staking/config/staking-pools", () => ({
  getStakingPoolById: vi.fn((id: string) => {
    if (id === "weth-usdc-volatile") {
      return {
        id: "weth-usdc-volatile",
        name: "WETH/USDC Volatile",
        poolAddress: POOL_ADDR,
        gaugeAddress: GAUGE,
        stable: false,
        tokenA: { symbol: "WETH", address: WETH, decimals: 18 },
        tokenB: { symbol: "USDC", address: USDC, decimals: 6 },
        rewardToken: { symbol: "AERO", address: AERO, decimals: 18 },
        enabled: true,
      };
    }
    return undefined;
  }),
  getEnabledStakingPools: vi.fn(() => [{
    id: "weth-usdc-volatile",
    name: "WETH/USDC Volatile",
    poolAddress: POOL_ADDR,
    gaugeAddress: GAUGE,
    stable: false,
    tokenA: { symbol: "WETH", address: WETH, decimals: 18 },
    tokenB: { symbol: "USDC", address: USDC, decimals: 6 },
    rewardToken: { symbol: "AERO", address: AERO, decimals: 18 },
    enabled: true,
  }]),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { aerodromeService } from "../../shared/services/aerodrome.service";
import { executeGetSwapQuote } from "../../modules/swap/usecases/get-quote.usecase";
import { executePrepareSwapBundle } from "../../modules/swap/usecases/prepare-swap.usecase";
import { executeEnterStrategy } from "../../modules/liquid-staking/usecases/prepare-enter-strategy.usecase";
import { executeExitStrategy } from "../../modules/liquid-staking/usecases/prepare-exit-strategy.usecase";
import { executeClaimRewards } from "../../modules/liquid-staking/usecases/prepare-claim-rewards.usecase";
import { executeGetPortfolio } from "../../modules/liquid-staking/usecases/get-portfolio.usecase";
import { ADAPTER_SELECTORS, PANORAMA_EXECUTOR_ABI_EXECUTE } from "../../shared/bundle-builder";
import { AppError } from "../../shared/errorCodes";

const svc = vi.mocked(aerodromeService);

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeExecuteStep(data: string) {
  const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
  return iface.decodeFunctionData("execute", data);
}

function findStepBySelector(steps: Array<{ to: string; data: string }>, selector: string) {
  return steps.find((s) => {
    if (s.to.toLowerCase() !== EXECUTOR.toLowerCase()) return false;
    try {
      return decodeExecuteStep(s.data)[1] === selector;
    } catch {
      return false;
    }
  });
}

/** Reset all mocks to a clean happy-path state. */
function resetToHappyPath() {
  vi.clearAllMocks();

  // Quote
  svc.getQuote.mockResolvedValue({ amountOut: 3_000_000n, route: [] });

  // Allowances: insufficient → forces approve steps
  svc.checkAllowance.mockResolvedValue({ allowance: 0n, sufficient: false });

  // Balances
  svc.getTokenBalance.mockResolvedValue(10_000_000_000_000_000_000n);
  mockBalanceOf.mockResolvedValue(BigInt("10000000000000000000"));

  // Pool / Gauge resolution
  svc.resolvePoolAndGauge.mockResolvedValue({ poolAddress: POOL_ADDR, gaugeAddress: GAUGE });

  // Adapter address
  svc.getUserAdapterAddress.mockResolvedValue(ADAPTER);

  // Staking
  svc.getStakedBalance.mockResolvedValue(500_000n);
  svc.getEarnedRewards.mockResolvedValue(100_000_000_000_000_000n); // 0.1 AERO

  // Liquidity quote
  svc.quoteAddLiquidity.mockResolvedValue({
    optimalA: 1_000_000_000_000_000_000n,
    optimalB: 3_000_000n,
    estimatedLiquidity: 1_000_000n,
  });

  // Wallet balance cache
  svc.getWalletBalanceCached.mockReturnValue(null);
  svc.setWalletBalanceCached.mockImplementation(() => {});

  // Pass-through helpers
  svc.withRetry.mockImplementation((fn: () => Promise<unknown>) => fn());
  svc.withTimeout.mockImplementation((fn: () => Promise<unknown>) => fn());
}

// ═══════════════════════════════════════════════════════════════════════════════
// FULL DEMO FLOW — 12 iterations for determinism
// ═══════════════════════════════════════════════════════════════════════════════

describe("E2E Demo Flow — canonical path (H5)", () => {
  const ITERATIONS = 12;
  const results: Array<{
    quoteAmountOut: string;
    swapSteps: number;
    enterSteps: number;
    portfolioPositions: number;
    claimSteps: number;
    exitSteps: number;
    portfolioAfterPositions: number;
  }> = [];

  beforeEach(resetToHappyPath);

  // Each iteration uses a unique user address to avoid portfolio cache collisions.
  // The portfolio module caches per-address with 30s TTL — using the same address
  // across iterations returns stale data from a previous run.
  function userForIteration(i: number): string {
    const hex = i.toString(16).padStart(40, "0");
    return `0x${hex}`;
  }

  for (let i = 1; i <= ITERATIONS; i++) {
    it(`iteration ${i}: full flow produces consistent output`, async () => {
      resetToHappyPath();
      const user = userForIteration(i);

      // ── Step 1: Quote swap ──────────────────────────────────────────
      const quote = await executeGetSwapQuote({
        tokenIn: WETH,
        tokenOut: USDC,
        amountIn: "1000000000000000000", // 1 WETH
        stable: "auto",
      });

      expect(quote.amountOut).toBe("3000000");
      expect(quote.tokenIn).toBe(WETH);
      expect(quote.tokenOut).toBe(USDC);
      expect(typeof quote.exchangeRate).toBe("string");
      expect(Number(quote.amountOutMin)).toBeLessThanOrEqual(Number(quote.amountOut));

      // ── Step 2: Prepare swap bundle ─────────────────────────────────
      const swap = await executePrepareSwapBundle({
        userAddress: user,
        tokenIn: WETH,
        tokenOut: USDC,
        amountIn: "1000000000000000000",
        amountOutPrecomputed: quote.amountOut,
      });

      expect(swap.bundle.steps.length).toBeGreaterThanOrEqual(1);
      expect(swap.bundle.steps.length).toBeLessThanOrEqual(2);
      for (const step of swap.bundle.steps) {
        expect(step.chainId).toBe(8453);
        expect(step.data).toBeTruthy();
      }
      const swapStep = findStepBySelector(swap.bundle.steps, ADAPTER_SELECTORS.SWAP);
      expect(swapStep).toBeDefined();
      expect(swap.metadata.amountOut).toBe(quote.amountOut);

      // ── Step 3: Check portfolio (before staking) ────────────────────
      svc.getStakedBalance.mockResolvedValue(0n);
      svc.getEarnedRewards.mockResolvedValue(0n);

      const portfolioBefore = await executeGetPortfolio(user);
      expect(portfolioBefore.userAddress).toBe(user);
      expect(portfolioBefore.totalPositions).toBe(0);
      expect(portfolioBefore.assets).toHaveLength(0);
      expect(portfolioBefore.walletBalances).toBeDefined();

      // ── Step 4: Enter staking position ──────────────────────────────
      resetToHappyPath();

      const enter = await executeEnterStrategy({
        userAddress: user,
        poolId: "weth-usdc-volatile",
        amountA: "1000000000000000000",
        amountB: "3000000",
      });

      expect(enter.bundle.steps.length).toBeGreaterThanOrEqual(3);
      expect(enter.bundle.totalSteps).toBe(enter.bundle.steps.length);
      expect(findStepBySelector(enter.bundle.steps, ADAPTER_SELECTORS.ADD_LIQUIDITY)).toBeDefined();
      expect(findStepBySelector(enter.bundle.steps, ADAPTER_SELECTORS.STAKE)).toBeDefined();
      expect(enter.metadata.poolAddress).toBe(POOL_ADDR);
      expect(enter.metadata.gaugeAddress).toBe(GAUGE);

      // ── Step 5: Check portfolio (has position) ──────────────────────
      // Use a different "user" address so portfolio cache doesn't return step 3 result
      const userWithPosition = `0x${"A".repeat(38)}${i.toString(16).padStart(2, "0")}`;
      svc.getStakedBalance.mockResolvedValue(500_000n);
      svc.getEarnedRewards.mockResolvedValue(100_000_000_000_000_000n);

      const portfolioAfterEnter = await executeGetPortfolio(userWithPosition);
      expect(portfolioAfterEnter.totalPositions).toBe(1);
      expect(portfolioAfterEnter.assets[0].poolId).toBe("weth-usdc-volatile");
      expect(BigInt(portfolioAfterEnter.assets[0].lpStaked)).toBeGreaterThan(0n);

      // ── Step 6: Claim rewards ───────────────────────────────────────
      const claim = await executeClaimRewards({
        userAddress: user,
        poolId: "weth-usdc-volatile",
      });

      expect(claim.bundle.steps).toHaveLength(1);
      expect(findStepBySelector(claim.bundle.steps, ADAPTER_SELECTORS.CLAIM_REWARDS)).toBeDefined();
      expect(claim.metadata.earnedRewards).toBe("100000000000000000");
      expect(claim.metadata.rewardToken.symbol).toBe("AERO");

      // ── Step 7: Exit position ───────────────────────────────────────
      const exit = await executeExitStrategy({
        userAddress: user,
        poolId: "weth-usdc-volatile",
      });

      expect(exit.bundle.steps.length).toBeGreaterThanOrEqual(2);
      expect(findStepBySelector(exit.bundle.steps, ADAPTER_SELECTORS.UNSTAKE)).toBeDefined();
      expect(findStepBySelector(exit.bundle.steps, ADAPTER_SELECTORS.REMOVE_LIQUIDITY)).toBeDefined();
      expect(exit.metadata.poolAddress).toBe(POOL_ADDR);

      // ── Step 8: Check portfolio (empty again) ───────────────────────
      const userAfterExit = `0x${"B".repeat(38)}${i.toString(16).padStart(2, "0")}`;
      svc.getStakedBalance.mockResolvedValue(0n);
      svc.getEarnedRewards.mockResolvedValue(0n);

      const portfolioAfterExit = await executeGetPortfolio(userAfterExit);
      expect(portfolioAfterExit.totalPositions).toBe(0);

      // Record results for determinism check
      results.push({
        quoteAmountOut: quote.amountOut,
        swapSteps: swap.bundle.steps.length,
        enterSteps: enter.bundle.steps.length,
        portfolioPositions: portfolioAfterEnter.totalPositions,
        claimSteps: claim.bundle.steps.length,
        exitSteps: exit.bundle.steps.length,
        portfolioAfterPositions: portfolioAfterExit.totalPositions,
      });
    });
  }

  it("all iterations produce identical results (determinism check)", () => {
    expect(results.length).toBe(ITERATIONS);
    const reference = results[0];
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toEqual(reference);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FALLBACK MESSAGING — common failure modes
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fallback messaging — common failures", () => {
  beforeEach(resetToHappyPath);

  // ── RPC timeout on quote ──────────────────────────────────────────

  describe("RPC timeout", () => {
    it("quote: both pools fail → AppError RPC_ERROR with retry message", async () => {
      svc.getQuote.mockRejectedValue(new Error("timeout"));

      const err = await executeGetSwapQuote({
        tokenIn: WETH, tokenOut: USDC, amountIn: "1000", stable: "auto",
      }).catch((e) => e);

      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe("RPC_ERROR");
      expect(err.message).toMatch(/try again/i);
    });

    it("quote: volatile fails but stable succeeds → returns stable result", async () => {
      svc.getQuote
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce({ amountOut: 2500n, route: [] });

      const result = await executeGetSwapQuote({
        tokenIn: WETH, tokenOut: USDC, amountIn: "1000", stable: "auto",
      });

      expect(result.stable).toBe(true);
      expect(result.amountOut).toBe("2500");
    });

    it("swap: allowance timeout → assumes 0, adds approve step (safe fallback)", async () => {
      svc.checkAllowance.mockRejectedValue(new Error("timeout"));
      svc.getTokenBalance.mockResolvedValue(999999n);

      const { bundle } = await executePrepareSwapBundle({
        userAddress: USER, tokenIn: WETH, tokenOut: USDC, amountIn: "1000",
      });

      // Should still have approve step (assumed 0 allowance)
      expect(bundle.steps).toHaveLength(2);
      expect(bundle.steps[0].to.toLowerCase()).toBe(WETH.toLowerCase());
    });

    it("swap: balance timeout → skips check, bundle still built", async () => {
      svc.checkAllowance.mockResolvedValue({ allowance: 99999n, sufficient: true });
      svc.getTokenBalance.mockRejectedValue(new Error("timeout"));

      const { bundle } = await executePrepareSwapBundle({
        userAddress: USER, tokenIn: WETH, tokenOut: USDC, amountIn: "1000",
      });

      expect(bundle.steps.length).toBeGreaterThanOrEqual(1);
      expect(findStepBySelector(bundle.steps, ADAPTER_SELECTORS.SWAP)).toBeDefined();
    });
  });

  // ── Insufficient balance ──────────────────────────────────────────

  describe("Insufficient balance", () => {
    it("swap: balance < amountIn → AppError INSUFFICIENT_BALANCE", async () => {
      svc.getTokenBalance.mockResolvedValue(500n); // have 500, need 1000

      const err = await executePrepareSwapBundle({
        userAddress: USER, tokenIn: WETH, tokenOut: USDC, amountIn: "1000",
      }).catch((e) => e);

      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe("INSUFFICIENT_BALANCE");
      expect(err.message).toMatch(/500.*1000/);
    });

    it("enter: zero balance after cap → AppError INSUFFICIENT_BALANCE", async () => {
      mockBalanceOf.mockResolvedValue(0n);

      const err = await executeEnterStrategy({
        userAddress: USER, poolId: "weth-usdc-volatile",
        amountA: "1000000000000000000", amountB: "3000000",
      }).catch((e) => e);

      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe("INSUFFICIENT_BALANCE");
    });
  });

  // ── Pool not found ────────────────────────────────────────────────

  describe("Pool not found", () => {
    it("enter: unknown poolId → AppError POOL_NOT_FOUND", async () => {
      const err = await executeEnterStrategy({
        userAddress: USER, poolId: "nonexistent-pool",
        amountA: "1000", amountB: "1000",
      }).catch((e) => e);

      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe("POOL_NOT_FOUND");
      expect(err.message).toMatch(/nonexistent-pool/);
    });

    it("exit: unknown poolId → AppError POOL_NOT_FOUND", async () => {
      const err = await executeExitStrategy({
        userAddress: USER, poolId: "nonexistent-pool",
      }).catch((e) => e);

      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe("POOL_NOT_FOUND");
    });

    it("claim: unknown poolId → AppError POOL_NOT_FOUND", async () => {
      const err = await executeClaimRewards({
        userAddress: USER, poolId: "nonexistent-pool",
      }).catch((e) => e);

      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe("POOL_NOT_FOUND");
    });
  });

  // ── No liquidity ──────────────────────────────────────────────────

  describe("No liquidity", () => {
    it("quote auto: both pools return 0 → AppError NO_LIQUIDITY", async () => {
      svc.getQuote.mockResolvedValue({ amountOut: 0n, route: [] });

      const err = await executeGetSwapQuote({
        tokenIn: WETH, tokenOut: USDC, amountIn: "1000", stable: "auto",
      }).catch((e) => e);

      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe("NO_LIQUIDITY");
    });

    it("enter: estimatedLiquidity = 0 → AppError NO_LIQUIDITY", async () => {
      svc.quoteAddLiquidity.mockResolvedValue({
        optimalA: 0n, optimalB: 0n, estimatedLiquidity: 0n,
      });

      const err = await executeEnterStrategy({
        userAddress: USER, poolId: "weth-usdc-volatile",
        amountA: "1000", amountB: "1000",
      }).catch((e) => e);

      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe("NO_LIQUIDITY");
    });
  });

  // ── No LP position / No rewards ───────────────────────────────────

  describe("No position / No rewards", () => {
    it("exit: no staked + no wallet LP → AppError NO_LP_POSITION", async () => {
      svc.getStakedBalance.mockResolvedValue(0n);
      svc.getTokenBalance.mockResolvedValue(0n);

      const err = await executeExitStrategy({
        userAddress: USER, poolId: "weth-usdc-volatile",
      }).catch((e) => e);

      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe("NO_LP_POSITION");
    });

    it("claim: no rewards → AppError NO_REWARDS", async () => {
      svc.getEarnedRewards.mockResolvedValue(0n);

      const err = await executeClaimRewards({
        userAddress: USER, poolId: "weth-usdc-volatile",
      }).catch((e) => e);

      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe("NO_REWARDS");
    });
  });

  // ── ETH native swap (no approve) ─────────────────────────────────

  describe("ETH native swap edge case", () => {
    it("ETH → USDC: no approve, value set on execute step", async () => {
      const { bundle } = await executePrepareSwapBundle({
        userAddress: USER, tokenIn: ETH_ADDR, tokenOut: USDC,
        amountIn: "500000000000000000",
      });

      expect(bundle.steps).toHaveLength(1);
      expect(bundle.steps[0].value).toBe("500000000000000000");
      expect(svc.checkAllowance).not.toHaveBeenCalled();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUNDLE STRUCTURE INVARIANTS — cross-cutting checks
// ═══════════════════════════════════════════════════════════════════════════════

describe("Bundle structure invariants (all operations)", () => {
  beforeEach(resetToHappyPath);

  const operations = [
    {
      name: "swap",
      run: () => executePrepareSwapBundle({
        userAddress: USER, tokenIn: WETH, tokenOut: USDC, amountIn: "1000",
      }).then((r) => r.bundle),
    },
    {
      name: "enter",
      run: () => executeEnterStrategy({
        userAddress: USER, poolId: "weth-usdc-volatile",
        amountA: "1000000000000000000", amountB: "3000000",
      }).then((r) => r.bundle),
    },
    {
      name: "exit",
      run: () => executeExitStrategy({
        userAddress: USER, poolId: "weth-usdc-volatile",
      }).then((r) => r.bundle),
    },
    {
      name: "claim",
      run: () => executeClaimRewards({
        userAddress: USER, poolId: "weth-usdc-volatile",
      }).then((r) => r.bundle),
    },
  ];

  for (const op of operations) {
    it(`${op.name}: all steps have chainId 8453`, async () => {
      resetToHappyPath();
      const bundle = await op.run();
      for (const step of bundle.steps) {
        expect(step.chainId).toBe(8453);
      }
    });

    it(`${op.name}: totalSteps matches steps.length`, async () => {
      resetToHappyPath();
      const bundle = await op.run();
      expect(bundle.totalSteps).toBe(bundle.steps.length);
    });

    it(`${op.name}: all steps have non-empty data`, async () => {
      resetToHappyPath();
      const bundle = await op.run();
      for (const step of bundle.steps) {
        expect(step.data.length).toBeGreaterThan(2); // at least "0x..."
      }
    });

    it(`${op.name}: execute steps decode against ABI`, async () => {
      resetToHappyPath();
      const bundle = await op.run();
      const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
      const execSteps = bundle.steps.filter(
        (s) => s.to.toLowerCase() === EXECUTOR.toLowerCase()
      );
      for (const step of execSteps) {
        expect(() => iface.decodeFunctionData("execute", step.data)).not.toThrow();
      }
    });

    it(`${op.name}: summary is a non-empty string`, async () => {
      resetToHappyPath();
      const bundle = await op.run();
      expect(typeof bundle.summary).toBe("string");
      expect(bundle.summary.length).toBeGreaterThan(0);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PORTFOLIO STALE FALLBACK
// ═══════════════════════════════════════════════════════════════════════════════

describe("Portfolio stale fallback", () => {
  beforeEach(resetToHappyPath);

  it("returns fresh data with lastUpdated and correct shape", async () => {
    // Use a unique address to avoid cache from other tests
    const uniqueUser = "0x" + "C".repeat(40);
    svc.getStakedBalance.mockResolvedValue(500_000n);
    svc.getEarnedRewards.mockResolvedValue(100_000_000_000_000_000n);

    const fresh = await executeGetPortfolio(uniqueUser);
    expect(fresh.stale).toBeUndefined();
    expect(fresh.lastUpdated).toBeDefined();
    expect(fresh.totalPositions).toBe(1);
    expect(fresh.assets[0].poolId).toBe("weth-usdc-volatile");
  });

  it("returns cached data on subsequent call within TTL", async () => {
    const uniqueUser = "0x" + "D".repeat(40);
    svc.getStakedBalance.mockResolvedValue(500_000n);
    svc.getEarnedRewards.mockResolvedValue(100_000_000_000_000_000n);

    const first = await executeGetPortfolio(uniqueUser);

    // Change mocks — if cache works, second call returns same data
    svc.getStakedBalance.mockResolvedValue(999_999n);
    const second = await executeGetPortfolio(uniqueUser);

    expect(second.totalPositions).toBe(first.totalPositions);
    expect(second.lastUpdated).toBe(first.lastUpdated);
  });
});
