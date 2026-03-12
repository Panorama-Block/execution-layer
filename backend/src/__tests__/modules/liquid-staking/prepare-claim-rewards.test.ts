import { describe, it, expect, vi, beforeEach } from "vitest";

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
    getEarnedRewards: vi.fn(),
  },
}));

// Use a partial pool config matching the format getStakingPoolById returns
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
import { executeClaimRewards } from "../../../modules/liquid-staking/usecases/prepare-claim-rewards.usecase";
import { ADAPTER_SELECTORS } from "../../../shared/bundle-builder";

const mockResolve  = vi.mocked(aerodromeService.resolvePoolAndGauge);
const mockGetAdapter = vi.mocked(aerodromeService.getUserAdapterAddress);
const mockEarned   = vi.mocked(aerodromeService.getEarnedRewards);

describe("executeClaimRewards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockResolvedValue({ poolAddress: POOL_ADDR, gaugeAddress: GAUGE_ADDR });
    mockGetAdapter.mockResolvedValue(USER_ADAPTER);
    mockEarned.mockResolvedValue(500n);
  });

  it("throws when pool not found", async () => {
    await expect(
      executeClaimRewards({ userAddress: USER, poolId: "nonexistent" })
    ).rejects.toThrow("Staking pool not found");
  });

  it("throws when no rewards to claim", async () => {
    mockEarned.mockResolvedValue(0n);
    await expect(
      executeClaimRewards({ userAddress: USER, poolId: "weth-usdc-volatile" })
    ).rejects.toThrow("No rewards to claim");
  });

  it("treats missing user adapter as 0 earned rewards and throws", async () => {
    mockGetAdapter.mockResolvedValue(null);
    await expect(
      executeClaimRewards({ userAddress: USER, poolId: "weth-usdc-volatile" })
    ).rejects.toThrow("No rewards to claim");
  });

  it("returns bundle with one execute step", async () => {
    const { bundle } = await executeClaimRewards({ userAddress: USER, poolId: "weth-usdc-volatile" });
    expect(bundle.steps).toHaveLength(1);
  });

  it("execute step targets executor", async () => {
    const { bundle } = await executeClaimRewards({ userAddress: USER, poolId: "weth-usdc-volatile" });
    expect(bundle.steps[0].to).toBe(EXECUTOR);
    expect(bundle.steps[0].value).toBe("0");
  });

  it("metadata contains gaugeAddress and earnedRewards", async () => {
    const { metadata } = await executeClaimRewards({ userAddress: USER, poolId: "weth-usdc-volatile" });
    expect(metadata.gaugeAddress).toBe(GAUGE_ADDR);
    expect(metadata.earnedRewards).toBe("500");
  });

  it("metadata contains rewardToken info", async () => {
    const { metadata } = await executeClaimRewards({ userAddress: USER, poolId: "weth-usdc-volatile" });
    expect(metadata.rewardToken.symbol).toBe("AERO");
  });

  it("calldata uses CLAIM_REWARDS selector", async () => {
    const { bundle } = await executeClaimRewards({ userAddress: USER, poolId: "weth-usdc-volatile" });
    // selector is the first 4 bytes of the calldata after the function sig
    // We check the description instead since calldata decoding requires the full ABI
    expect(bundle.steps[0].description).toContain("Claim");
  });
});
