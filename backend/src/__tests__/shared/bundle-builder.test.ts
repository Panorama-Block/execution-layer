import { describe, it, expect, beforeEach } from "vitest";
import { ethers } from "ethers";
import {
  BundleBuilder,
  ADAPTER_SELECTORS,
  PANORAMA_EXECUTOR_ABI_EXECUTE,
} from "../../shared/bundle-builder";

const CHAIN_ID    = 8453;
const EXECUTOR    = "0x82b000512A19f7B762A23033aEA5AE00aBD0D2bC";
const TOKEN_IN    = "0x4200000000000000000000000000000000000006"; // WETH
const USDC        = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PROTOCOL_ID = ethers.keccak256(ethers.toUtf8Bytes("aerodrome"));
const DEADLINE    = Math.floor(Date.now() / 1000) + 1200;

// ── ADAPTER_SELECTORS ─────────────────────────────────────────────────────────

describe("ADAPTER_SELECTORS", () => {
  it("SWAP is bytes4(keccak256('swap(address,address,uint256,uint256,address,bool)'))", () => {
    expect(ADAPTER_SELECTORS.SWAP).toBe(
      ethers.id("swap(address,address,uint256,uint256,address,bool)").slice(0, 10)
    );
  });

  it("ADD_LIQUIDITY is bytes4(keccak256('addLiquidity(address,address,bool,uint256,uint256,uint256,uint256,address)'))", () => {
    expect(ADAPTER_SELECTORS.ADD_LIQUIDITY).toBe(
      ethers.id("addLiquidity(address,address,bool,uint256,uint256,uint256,uint256,address)").slice(0, 10)
    );
  });

  it("REMOVE_LIQUIDITY is bytes4(keccak256('removeLiquidity(address,address,bool,uint256,uint256,uint256,address,address)'))", () => {
    expect(ADAPTER_SELECTORS.REMOVE_LIQUIDITY).toBe(
      ethers.id("removeLiquidity(address,address,bool,uint256,uint256,uint256,address,address)").slice(0, 10)
    );
  });

  it("STAKE is bytes4(keccak256('stake(address,uint256,address)'))", () => {
    expect(ADAPTER_SELECTORS.STAKE).toBe(
      ethers.id("stake(address,uint256,address)").slice(0, 10)
    );
  });

  it("UNSTAKE is bytes4(keccak256('unstake(address,uint256,address,address)'))", () => {
    expect(ADAPTER_SELECTORS.UNSTAKE).toBe(
      ethers.id("unstake(address,uint256,address,address)").slice(0, 10)
    );
  });

  it("CLAIM_REWARDS is bytes4(keccak256('claimRewards(address,address,address)'))", () => {
    expect(ADAPTER_SELECTORS.CLAIM_REWARDS).toBe(
      ethers.id("claimRewards(address,address,address)").slice(0, 10)
    );
  });

  it("all selectors are 10-character hex strings (0x + 4 bytes)", () => {
    for (const selector of Object.values(ADAPTER_SELECTORS)) {
      expect(selector).toMatch(/^0x[0-9a-f]{8}$/);
    }
  });

  it("all selectors are unique", () => {
    const values = Object.values(ADAPTER_SELECTORS);
    expect(new Set(values).size).toBe(values.length);
  });
});

// ── BundleBuilder ─────────────────────────────────────────────────────────────

describe("BundleBuilder", () => {
  let builder: BundleBuilder;

  beforeEach(() => {
    builder = new BundleBuilder(CHAIN_ID);
  });

  // ── addApproveIfNeeded ─────────────────────────────────────────────────────

  describe("addApproveIfNeeded", () => {
    it("skips approve step when allowance >= required", () => {
      builder.addApproveIfNeeded(TOKEN_IN, EXECUTOR, 1000n, 500n, "Approve WETH");
      expect(builder.build("test").steps).toHaveLength(0);
    });

    it("skips approve step when allowance equals required exactly", () => {
      builder.addApproveIfNeeded(TOKEN_IN, EXECUTOR, 500n, 500n, "Approve WETH");
      expect(builder.build("").steps).toHaveLength(0);
    });

    it("adds approve step when allowance < required", () => {
      builder.addApproveIfNeeded(TOKEN_IN, EXECUTOR, 100n, 500n, "Approve WETH");
      const bundle = builder.build("test");
      expect(bundle.steps).toHaveLength(1);
      const step = bundle.steps[0];
      expect(step.to).toBe(TOKEN_IN);
      expect(step.value).toBe("0");
      expect(step.chainId).toBe(CHAIN_ID);
      expect(step.description).toBe("Approve WETH");
    });

    it("approve step uses MaxUint256 amount", () => {
      builder.addApproveIfNeeded(TOKEN_IN, EXECUTOR, 0n, 1n, "Approve");
      const step  = builder.build("").steps[0];
      const iface = new ethers.Interface(["function approve(address spender, uint256 amount) external returns (bool)"]);
      const decoded = iface.decodeFunctionData("approve", step.data);
      expect(decoded[0]).toBe(EXECUTOR);
      expect(decoded[1]).toBe(ethers.MaxUint256);
    });

    it("returns builder instance for chaining", () => {
      const result = builder.addApproveIfNeeded(TOKEN_IN, EXECUTOR, 0n, 1n, "Approve");
      expect(result).toBe(builder);
    });
  });

  // ── addExecute ─────────────────────────────────────────────────────────────

  describe("addExecute", () => {
    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256", "uint256", "address", "bool"],
      [TOKEN_IN, USDC, 1000n, 950n, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", false]
    );

    it("adds a step to the executor address", () => {
      builder.addExecute(PROTOCOL_ID, ADAPTER_SELECTORS.SWAP,
        [{ token: TOKEN_IN, amount: 1000n }], DEADLINE, adapterData, 0n, EXECUTOR, "Swap WETH→USDC");
      expect(builder.build("").steps[0].to).toBe(EXECUTOR);
    });

    it("sets correct value for ETH operations", () => {
      builder.addExecute(PROTOCOL_ID, ADAPTER_SELECTORS.SWAP, [], DEADLINE, adapterData, 5000n, EXECUTOR, "ETH swap");
      expect(builder.build("").steps[0].value).toBe("5000");
    });

    it("sets value '0' for ERC-20 operations", () => {
      builder.addExecute(PROTOCOL_ID, ADAPTER_SELECTORS.SWAP,
        [{ token: TOKEN_IN, amount: 1000n }], DEADLINE, adapterData, 0n, EXECUTOR, "Swap");
      expect(builder.build("").steps[0].value).toBe("0");
    });

    it("encodes calldata that decodes back to original arguments", () => {
      const transfers = [{ token: TOKEN_IN, amount: 1000n }];
      builder.addExecute(PROTOCOL_ID, ADAPTER_SELECTORS.SWAP,
        transfers, DEADLINE, adapterData, 0n, EXECUTOR, "Swap");
      const step  = builder.build("").steps[0];
      const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
      const decoded = iface.decodeFunctionData("execute", step.data);
      expect(decoded[0]).toBe(PROTOCOL_ID);
      expect(decoded[1]).toBe(ADAPTER_SELECTORS.SWAP);
      expect(decoded[2][0].token).toBe(TOKEN_IN);
      expect(decoded[2][0].amount).toBe(1000n);
      expect(Number(decoded[3])).toBe(DEADLINE);
      expect(decoded[4]).toBe(adapterData);
    });

    it("STAKE action encodes correctly", () => {
      const stakeData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "address"],
        [TOKEN_IN, 500n, "0x000000000000000000000000000000000000dEaD"]
      );
      builder.addExecute(PROTOCOL_ID, ADAPTER_SELECTORS.STAKE,
        [{ token: TOKEN_IN, amount: 500n }], DEADLINE, stakeData, 0n, EXECUTOR, "Stake LP");
      const step  = builder.build("").steps[0];
      const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
      const decoded = iface.decodeFunctionData("execute", step.data);
      expect(decoded[1]).toBe(ADAPTER_SELECTORS.STAKE);
    });

    it("returns builder instance for chaining", () => {
      const result = builder.addExecute(PROTOCOL_ID, ADAPTER_SELECTORS.SWAP, [], DEADLINE, adapterData, 0n, EXECUTOR, "Swap");
      expect(result).toBe(builder);
    });

    it("sets correct chainId on steps", () => {
      builder.addExecute(PROTOCOL_ID, ADAPTER_SELECTORS.SWAP, [], DEADLINE, adapterData, 0n, EXECUTOR, "Swap");
      expect(builder.build("").steps[0].chainId).toBe(CHAIN_ID);
    });
  });

  // ── build ──────────────────────────────────────────────────────────────────

  describe("build", () => {
    it("returns bundle with correct summary", () => {
      expect(builder.build("My bundle").summary).toBe("My bundle");
    });

    it("totalSteps matches steps array length", () => {
      builder
        .addApproveIfNeeded(TOKEN_IN, EXECUTOR, 0n, 1n, "Approve")
        .addExecute(PROTOCOL_ID, ADAPTER_SELECTORS.SWAP, [], DEADLINE, "0x", 0n, EXECUTOR, "Swap");
      const bundle = builder.build("test");
      expect(bundle.totalSteps).toBe(bundle.steps.length);
      expect(bundle.totalSteps).toBe(2);
    });

    it("returns a copy of steps (mutation does not affect builder)", () => {
      builder.addExecute(PROTOCOL_ID, ADAPTER_SELECTORS.SWAP, [], DEADLINE, "0x", 0n, EXECUTOR, "Swap");
      const bundle1 = builder.build("first");
      bundle1.steps.push({} as never);
      expect(builder.build("second").steps).toHaveLength(1);
    });

    it("empty builder produces empty bundle", () => {
      const bundle = builder.build("empty");
      expect(bundle.steps).toHaveLength(0);
      expect(bundle.totalSteps).toBe(0);
    });
  });

  // ── chaining ──────────────────────────────────────────────────────────────

  it("builds multi-step bundle via chaining", () => {
    const bundle = builder
      .addApproveIfNeeded(TOKEN_IN, EXECUTOR, 0n, 1000n, "Approve WETH")
      .addExecute(PROTOCOL_ID, ADAPTER_SELECTORS.SWAP, [], DEADLINE, "0x", 0n, EXECUTOR, "Swap")
      .build("Approve + Swap");
    expect(bundle.steps).toHaveLength(2);
    expect(bundle.steps[0].to).toBe(TOKEN_IN);
    expect(bundle.steps[1].to).toBe(EXECUTOR);
    expect(bundle.summary).toBe("Approve + Swap");
  });
});
