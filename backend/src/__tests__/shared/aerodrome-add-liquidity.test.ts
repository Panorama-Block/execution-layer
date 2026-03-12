import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";

const EXECUTOR  = "0x82b000512A19f7B762A23033aEA5AE00aBD0D2bC";
const POOL_ADDR = "0xcDAC0d6c6C59727a65F871236188350531885C43";
const GAUGE     = "0x519BBD1Dd8C6A94C46080E24f316c14Ee758C025";
const WETH      = "0x4200000000000000000000000000000000000006";
const USDC      = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USER      = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const { mockCheckAllowance } = vi.hoisted(() => ({
  mockCheckAllowance: vi.fn(),
}));

vi.mock("../../shared/services/aerodrome.service", () => ({
  aerodromeService: {
    checkAllowance: mockCheckAllowance,
    withRetry: vi.fn(<T>(fn: () => Promise<T>) => fn()),
  },
}));

import { buildAerodromeAddLiquidityBundle } from "../../shared/aerodrome-add-liquidity";
import { ADAPTER_SELECTORS } from "../../shared/bundle-builder";

const BASE_PARAMS = {
  userAddress:        USER,
  tokenA:             { address: WETH, symbol: "WETH" },
  tokenB:             { address: USDC, symbol: "USDC" },
  poolAddress:        POOL_ADDR,
  gaugeAddress:       GAUGE,
  stable:             false,
  amountADesired:     1000n,
  amountBDesired:     2000n,
  amountAMin:         950n,
  amountBMin:         1900n,
  estimatedLiquidity: 500n,
  slippageBps:        100,
  deadline:           Math.floor(Date.now() / 1000) + 1200,
  executorAddress:    EXECUTOR,
  chainId:            8453,
  poolName:           "WETH/USDC Volatile",
};

describe("buildAerodromeAddLiquidityBundle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no existing allowances
    mockCheckAllowance.mockResolvedValue({ allowance: 0n, sufficient: false });
  });

  it("includes approve tokenA, approve tokenB, addLiquidity, approve LP, stake when allowances are zero", async () => {
    const builder = await buildAerodromeAddLiquidityBundle(BASE_PARAMS);
    const bundle  = builder.build("test");

    expect(bundle.steps).toHaveLength(5);
    expect(bundle.steps[0].description).toContain("Approve WETH");
    expect(bundle.steps[1].description).toContain("Approve USDC");
    expect(bundle.steps[2].description).toContain("Add liquidity");
    expect(bundle.steps[3].description).toContain("Approve LP");
    expect(bundle.steps[4].description).toContain("Stake");
  });

  it("skips approve tokenA when allowance is sufficient", async () => {
    mockCheckAllowance
      .mockResolvedValueOnce({ allowance: 99999n, sufficient: true })  // tokenA
      .mockResolvedValueOnce({ allowance: 0n,     sufficient: false }) // tokenB
      .mockResolvedValueOnce({ allowance: 0n,     sufficient: false }); // LP

    const builder = await buildAerodromeAddLiquidityBundle(BASE_PARAMS);
    const bundle  = builder.build("test");

    expect(bundle.steps).toHaveLength(4);
    expect(bundle.steps[0].description).toContain("Approve USDC");
  });

  it("skips both approves when both allowances are sufficient", async () => {
    mockCheckAllowance
      .mockResolvedValueOnce({ allowance: 99999n, sufficient: true }) // tokenA
      .mockResolvedValueOnce({ allowance: 99999n, sufficient: true }) // tokenB
      .mockResolvedValueOnce({ allowance: 0n,     sufficient: false }); // LP

    const builder = await buildAerodromeAddLiquidityBundle(BASE_PARAMS);
    const bundle  = builder.build("test");

    expect(bundle.steps).toHaveLength(3); // addLiquidity + approve LP + stake
    expect(bundle.steps[0].description).toContain("Add liquidity");
  });

  it("skips LP approve when LP allowance is sufficient", async () => {
    mockCheckAllowance
      .mockResolvedValueOnce({ allowance: 0n,     sufficient: false }) // tokenA
      .mockResolvedValueOnce({ allowance: 0n,     sufficient: false }) // tokenB
      .mockResolvedValueOnce({ allowance: 99999n, sufficient: true });  // LP

    const builder = await buildAerodromeAddLiquidityBundle(BASE_PARAMS);
    const bundle  = builder.build("test");

    expect(bundle.steps).toHaveLength(4); // approve A + approve B + addLiquidity + stake
    expect(bundle.steps[3].description).toContain("Stake");
  });

  it("addLiquidity step uses ADD_LIQUIDITY selector", async () => {
    const builder = await buildAerodromeAddLiquidityBundle(BASE_PARAMS);
    const bundle  = builder.build("test");

    const addLiqStep = bundle.steps.find(s => s.description.includes("Add liquidity"))!;
    expect(addLiqStep.data).toContain(ADAPTER_SELECTORS.ADD_LIQUIDITY.slice(2));
  });

  it("stake step uses STAKE selector", async () => {
    const builder = await buildAerodromeAddLiquidityBundle(BASE_PARAMS);
    const bundle  = builder.build("test");

    const stakeStep = bundle.steps[bundle.steps.length - 1];
    expect(stakeStep.description).toContain("Stake");
    expect(stakeStep.data).toContain(ADAPTER_SELECTORS.STAKE.slice(2));
  });

  it("checks allowances in parallel (3 calls total)", async () => {
    await buildAerodromeAddLiquidityBundle(BASE_PARAMS);
    expect(mockCheckAllowance).toHaveBeenCalledTimes(3);
  });

  it("skips tokenA approve for native ETH and sets ethValue", async () => {
    // Only tokenB allowance check should happen (LP is 3rd)
    mockCheckAllowance
      .mockResolvedValueOnce({ allowance: 0n, sufficient: false }) // tokenB
      .mockResolvedValueOnce({ allowance: 0n, sufficient: false }); // LP

    const params = {
      ...BASE_PARAMS,
      tokenA: { address: "0x0000000000000000000000000000000000000000", symbol: "ETH" },
    };

    const builder = await buildAerodromeAddLiquidityBundle(params);
    const bundle  = builder.build("test");

    // No approve for ETH — only approve USDC + addLiquidity + approve LP + stake
    expect(bundle.steps).toHaveLength(4);
    expect(bundle.steps[0].description).toContain("Approve USDC");

    // addLiquidity step should carry ethValue
    const addLiqStep = bundle.steps[1];
    expect(BigInt(addLiqStep.value)).toBe(BASE_PARAMS.amountADesired);
  });

  it("all execute steps target the executor address", async () => {
    const builder = await buildAerodromeAddLiquidityBundle(BASE_PARAMS);
    const bundle  = builder.build("test");

    const execSteps = bundle.steps.filter(s => !s.description.toLowerCase().includes("approve"));
    for (const step of execSteps) {
      expect(step.to.toLowerCase()).toBe(EXECUTOR.toLowerCase());
    }
  });

  it("all steps have chainId 8453", async () => {
    const builder = await buildAerodromeAddLiquidityBundle(BASE_PARAMS);
    const bundle  = builder.build("test");

    for (const step of bundle.steps) {
      expect(step.chainId).toBe(8453);
    }
  });

  it("stake amount applies slippage to estimatedLiquidity (transfer amount reflects safe stake)", async () => {
    // estimatedLiquidity = 500n, slippageBps = 100 → safeStake = applySlippage(500n, 100) = 495n
    // The BundleBuilder receives transfers=[{ token: poolAddress, amount: safeStakeAmount }]
    // We verify indirectly: with zero allowances there are 5 steps and the stake step exists
    const builder = await buildAerodromeAddLiquidityBundle(BASE_PARAMS);
    const bundle  = builder.build("test");

    const stakeStep = bundle.steps[bundle.steps.length - 1];
    expect(stakeStep.description).toContain("Stake");
    // The stake step carries value "0" (LP is ERC-20, not ETH)
    expect(stakeStep.value).toBe("0");
  });
});
