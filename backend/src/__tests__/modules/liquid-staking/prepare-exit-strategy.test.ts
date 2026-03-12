import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";

const EXECUTOR    = "0x82b000512A19f7B762A23033aEA5AE00aBD0D2bC";
const POOL_ADDR   = "0xcDAC0d6c6C59727a65F871236188350531885C43";
const GAUGE_ADDR  = "0x519BBD1Dd8C6A94C46080E24f316c14Ee758C025";
const USER        = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const USER_ADAPTER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

vi.mock("../../../config/chains", () => ({
  getChainConfig: vi.fn(() => ({
    chainId: 8453,
    contracts: { panoramaExecutor: EXECUTOR },
  })),
}));

vi.mock("../../../shared/services/aerodrome.service", () => ({
  aerodromeService: {
    resolvePoolAndGauge: vi.fn(),
    getUserAdapterAddress: vi.fn(),
    getStakedBalance: vi.fn(),
    getTokenBalance: vi.fn(),
    checkAllowance: vi.fn(),
  },
}));

vi.mock("../../../modules/liquid-staking/config/staking-pools", () => ({
  getStakingPoolById: vi.fn((id: string) => {
    if (id === "weth-usdc-volatile") {
      return {
        id: "weth-usdc-volatile",
        name: "WETH/USDC Volatile",
        poolAddress: POOL_ADDR,
        gaugeAddress: GAUGE_ADDR,
        tokenA: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
        tokenB: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
        stable: false,
        rewardToken: { symbol: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
        enabled: true,
      };
    }
    return null;
  }),
}));

import { aerodromeService } from "../../../shared/services/aerodrome.service";
import { executeExitStrategy } from "../../../modules/liquid-staking/usecases/prepare-exit-strategy.usecase";
import { PANORAMA_EXECUTOR_ABI_EXECUTE, ADAPTER_SELECTORS } from "../../../shared/bundle-builder";

const mockResolve     = vi.mocked(aerodromeService.resolvePoolAndGauge);
const mockGetAdapter  = vi.mocked(aerodromeService.getUserAdapterAddress);
const mockStaked      = vi.mocked(aerodromeService.getStakedBalance);
const mockWalletBal   = vi.mocked(aerodromeService.getTokenBalance);
const mockAllowance   = vi.mocked(aerodromeService.checkAllowance);

describe("executeExitStrategy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockResolvedValue({ poolAddress: POOL_ADDR, gaugeAddress: GAUGE_ADDR });
    mockGetAdapter.mockResolvedValue(USER_ADAPTER);
    mockStaked.mockResolvedValue(1000n);
    mockWalletBal.mockResolvedValue(0n);
    mockAllowance.mockResolvedValue({ allowance: 0n, sufficient: false });
  });

  it("throws when pool not found", async () => {
    await expect(
      executeExitStrategy({ userAddress: USER, poolId: "nonexistent" })
    ).rejects.toThrow("Staking pool not found");
  });

  it("throws when no LP position found (staked=0, wallet=0)", async () => {
    mockStaked.mockResolvedValue(0n);
    mockWalletBal.mockResolvedValue(0n);
    await expect(
      executeExitStrategy({ userAddress: USER, poolId: "weth-usdc-volatile" })
    ).rejects.toThrow("No LP position found");
  });

  it("throws when requested amount exceeds total available", async () => {
    mockStaked.mockResolvedValue(500n);
    mockWalletBal.mockResolvedValue(0n);
    await expect(
      executeExitStrategy({ userAddress: USER, poolId: "weth-usdc-volatile", amount: "1000" })
    ).rejects.toThrow("Insufficient LP balance");
  });

  it("full exit includes unstake + approve + removeLiquidity steps", async () => {
    const { bundle } = await executeExitStrategy({ userAddress: USER, poolId: "weth-usdc-volatile" });
    // unstake + approve LP + remove liquidity
    expect(bundle.steps).toHaveLength(3);
  });

  it("skips unstake step when all LP is in wallet (staked=0)", async () => {
    mockStaked.mockResolvedValue(0n);
    mockWalletBal.mockResolvedValue(800n);
    const { bundle } = await executeExitStrategy({ userAddress: USER, poolId: "weth-usdc-volatile" });
    // approve + remove (no unstake)
    expect(bundle.steps).toHaveLength(2);
  });

  it("skips approve step when LP allowance is sufficient", async () => {
    mockAllowance.mockResolvedValue({ allowance: 99999n, sufficient: true });
    const { bundle } = await executeExitStrategy({ userAddress: USER, poolId: "weth-usdc-volatile" });
    // unstake + remove (no approve)
    expect(bundle.steps).toHaveLength(2);
  });

  it("metadata lpFromStaked and lpFromWallet sum to lpAmount", async () => {
    mockStaked.mockResolvedValue(600n);
    mockWalletBal.mockResolvedValue(400n);
    const { metadata } = await executeExitStrategy({ userAddress: USER, poolId: "weth-usdc-volatile" });
    const { lpFromStaked, lpFromWallet, lpAmount } = metadata;
    expect(BigInt(lpFromStaked) + BigInt(lpFromWallet)).toBe(BigInt(lpAmount));
  });

  it("unstake step uses UNSTAKE selector", async () => {
    const { bundle } = await executeExitStrategy({ userAddress: USER, poolId: "weth-usdc-volatile" });
    const unstakeStep = bundle.steps[0];
    const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
    const decoded = iface.decodeFunctionData("execute", unstakeStep.data);
    expect(decoded[1]).toBe(ADAPTER_SELECTORS.UNSTAKE);
  });

  it("unstake step has empty transfers (adapter handles LP transfer)", async () => {
    const { bundle } = await executeExitStrategy({ userAddress: USER, poolId: "weth-usdc-volatile" });
    const unstakeStep = bundle.steps[0];
    const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
    const decoded = iface.decodeFunctionData("execute", unstakeStep.data);
    expect(decoded[2]).toHaveLength(0);
  });

  it("remove liquidity step uses REMOVE_LIQUIDITY selector", async () => {
    const { bundle } = await executeExitStrategy({ userAddress: USER, poolId: "weth-usdc-volatile" });
    const removeStep = bundle.steps[bundle.steps.length - 1];
    const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
    const decoded = iface.decodeFunctionData("execute", removeStep.data);
    expect(decoded[1]).toBe(ADAPTER_SELECTORS.REMOVE_LIQUIDITY);
  });

  it("metadata contains poolAddress, gaugeAddress, stable", async () => {
    const { metadata } = await executeExitStrategy({ userAddress: USER, poolId: "weth-usdc-volatile" });
    expect(metadata.poolAddress).toBe(POOL_ADDR);
    expect(metadata.gaugeAddress).toBe(GAUGE_ADDR);
    expect(metadata.stable).toBe(false);
  });

  it("uses partial amount when specified", async () => {
    mockStaked.mockResolvedValue(1000n);
    const { metadata } = await executeExitStrategy({
      userAddress: USER, poolId: "weth-usdc-volatile", amount: "500",
    });
    expect(metadata.lpAmount).toBe("500");
  });
});
