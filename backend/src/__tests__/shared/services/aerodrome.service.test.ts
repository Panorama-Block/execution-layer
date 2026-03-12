import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ethers } from "ethers";

// Mock chain.provider and protocols before importing the service
vi.mock("../../../providers/chain.provider", () => ({
  getContract: vi.fn(),
}));

vi.mock("../../../config/protocols", async () => {
  const actual = await vi.importActual<typeof import("../../../config/protocols")>(
    "../../../config/protocols"
  );
  return {
    ...actual,
    getProtocolConfig: vi.fn(() => ({
      protocolId: "aerodrome",
      name: "Aerodrome Finance",
      chain: "base",
      contracts: {
        router: "0xRouter",
        factory: "0xFactory",
        voter: "0xVoter",
      },
      adapterAddress: "",
    })),
    getUserAdapterAddress: vi.fn(),
  };
});

import { getContract } from "../../../providers/chain.provider";
import { AerodromeService } from "../../../shared/services/aerodrome.service";

const mockGetContract = vi.mocked(getContract);

describe("AerodromeService", () => {
  let service: AerodromeService;

  beforeEach(() => {
    // Create a fresh instance per test so the module-level walletBalanceCache
    // shared between singleton tests is isolated by using fresh instances here.
    service = new AerodromeService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── protocolId ──────────────────────────────────────────────────────────────

  it("protocolId equals keccak256('aerodrome')", () => {
    expect(service.protocolId).toBe(
      ethers.keccak256(ethers.toUtf8Bytes("aerodrome"))
    );
  });

  // ── withRetry ───────────────────────────────────────────────────────────────

  describe("withRetry", () => {
    it("returns result on first attempt", async () => {
      const fn = vi.fn().mockResolvedValue("ok");
      await expect(service.withRetry(fn, 2, 0)).resolves.toBe("ok");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("retries on failure and succeeds on second attempt", async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error("transient failure"))
        .mockResolvedValue("recovered");
      await expect(service.withRetry(fn, 2, 1)).resolves.toBe("recovered");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("throws the last error after max retries exhausted", async () => {
      const err = new Error("persistent failure");
      const fn = vi.fn().mockRejectedValue(err);
      await expect(service.withRetry(fn, 2, 1)).rejects.toThrow("persistent failure");
      expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it("throws wrapped error when rejection is not an Error instance", async () => {
      const fn = vi.fn().mockRejectedValue("string error");
      await expect(service.withRetry(fn, 0, 0)).rejects.toThrow("retry failed");
    });
  });

  // ── withTimeout ─────────────────────────────────────────────────────────────

  describe("withTimeout", () => {
    it("resolves when promise completes before timeout", async () => {
      const fn = () => Promise.resolve(42);
      await expect(service.withTimeout(fn, 500)).resolves.toBe(42);
    });

    it("rejects with timeout error when promise is too slow", async () => {
      vi.useFakeTimers();
      const fn = () => new Promise<never>(() => {}); // never resolves
      const promise = service.withTimeout(fn, 100);
      vi.advanceTimersByTime(200);
      await expect(promise).rejects.toThrow("timeout");
    });
  });

  // ── safeBigInt ──────────────────────────────────────────────────────────────

  describe("safeBigInt", () => {
    it("returns the bigint value when function succeeds", async () => {
      await expect(service.safeBigInt(() => Promise.resolve(12345n))).resolves.toBe(12345n);
    });

    it("returns 0n when function throws", async () => {
      await expect(service.safeBigInt(() => Promise.reject(new Error("rpc error")))).resolves.toBe(0n);
    });

    it("returns 0n when function times out", async () => {
      vi.useFakeTimers();
      const fn = () => new Promise<bigint>(() => {}); // never resolves
      const promise = service.safeBigInt(fn);
      vi.advanceTimersByTime(5000);
      await expect(promise).resolves.toBe(0n);
    });
  });

  // ── Wallet balance cache ─────────────────────────────────────────────────────

  describe("wallet balance cache", () => {
    it("returns null for a key that was never set", () => {
      expect(service.getWalletBalanceCached("0xNobody", "WETH")).toBeNull();
    });

    it("stores and retrieves a value", () => {
      service.setWalletBalanceCached("0xUser", "WETH", "1.5");
      expect(service.getWalletBalanceCached("0xUser", "WETH")).toBe("1.5");
    });

    it("is case-insensitive for address and symbol", () => {
      service.setWalletBalanceCached("0xUSER", "weth", "2.0");
      expect(service.getWalletBalanceCached("0xuser", "WETH")).toBe("2.0");
    });

    it("returns null after TTL of 90s expires", () => {
      vi.useFakeTimers();
      service.setWalletBalanceCached("0xUser2", "USDC", "100");
      vi.advanceTimersByTime(90_001);
      expect(service.getWalletBalanceCached("0xUser2", "USDC")).toBeNull();
    });

    it("still returns value before TTL expires", () => {
      vi.useFakeTimers();
      service.setWalletBalanceCached("0xUser3", "AERO", "50");
      vi.advanceTimersByTime(89_999);
      expect(service.getWalletBalanceCached("0xUser3", "AERO")).toBe("50");
    });
  });

  // ── resolvePoolAndGauge ──────────────────────────────────────────────────────

  describe("resolvePoolAndGauge", () => {
    const poolConfig = {
      name: "WETH/USDC Volatile",
      poolAddress: "0xPoolConfig",
      gaugeAddress: "0xGaugeConfig",
      tokenA: { address: "0xWETH" },
      tokenB: { address: "0xUSDC" },
      stable: false,
    };

    it("uses poolAddress from config when set and non-zero", async () => {
      const spy = vi.spyOn(service, "getPoolAddress");
      const result = await service.resolvePoolAndGauge(poolConfig);
      expect(result.poolAddress).toBe("0xPoolConfig");
      expect(spy).not.toHaveBeenCalled();
    });

    it("uses gaugeAddress from config when set and non-zero", async () => {
      const spy = vi.spyOn(service, "getGaugeForPool");
      const result = await service.resolvePoolAndGauge(poolConfig);
      expect(result.gaugeAddress).toBe("0xGaugeConfig");
      expect(spy).not.toHaveBeenCalled();
    });

    it("falls back to on-chain lookup when poolAddress is ZeroAddress", async () => {
      const configNoPool = { ...poolConfig, poolAddress: ethers.ZeroAddress };
      vi.spyOn(service, "getPoolAddress").mockResolvedValue("0xOnChainPool");
      vi.spyOn(service, "getGaugeForPool").mockResolvedValue("0xGaugeConfig");
      const result = await service.resolvePoolAndGauge(configNoPool);
      expect(result.poolAddress).toBe("0xOnChainPool");
    });

    it("falls back to on-chain lookup when gaugeAddress is ZeroAddress", async () => {
      const configNoGauge = { ...poolConfig, gaugeAddress: ethers.ZeroAddress };
      vi.spyOn(service, "getGaugeForPool").mockResolvedValue("0xOnChainGauge");
      const result = await service.resolvePoolAndGauge(configNoGauge);
      expect(result.gaugeAddress).toBe("0xOnChainGauge");
    });

    it("throws when pool not found on-chain (ZeroAddress result)", async () => {
      const configNoPool = { ...poolConfig, poolAddress: ethers.ZeroAddress };
      vi.spyOn(service, "getPoolAddress").mockResolvedValue(ethers.ZeroAddress);
      await expect(service.resolvePoolAndGauge(configNoPool)).rejects.toThrow(
        "Pool not found on-chain"
      );
    });

    it("throws when gauge not found on-chain (ZeroAddress result)", async () => {
      const configNoGauge = { ...poolConfig, gaugeAddress: ethers.ZeroAddress };
      vi.spyOn(service, "getGaugeForPool").mockResolvedValue(ethers.ZeroAddress);
      await expect(service.resolvePoolAndGauge(configNoGauge)).rejects.toThrow(
        "Gauge not found"
      );
    });
  });

  // ── getQuote ─────────────────────────────────────────────────────────────────

  describe("getQuote", () => {
    const mockRouter = {
      getAmountsOut: vi.fn(),
    };

    beforeEach(() => {
      mockGetContract.mockReturnValue(mockRouter as never);
    });

    it("returns the last amount in the router result", async () => {
      mockRouter.getAmountsOut.mockResolvedValue([1000n, 1950n]);
      const { amountOut } = await service.getQuote("0xTokenIn", "0xTokenOut", 1000n, false);
      expect(amountOut).toBe(1950n);
    });

    it("resolves ETH address to WETH in the route", async () => {
      const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";
      const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
      mockRouter.getAmountsOut.mockResolvedValue([1000n, 2000n]);
      await service.getQuote(ETH_ADDRESS, "0xTokenOut", 1000n, false);
      const route = mockRouter.getAmountsOut.mock.calls[0][1];
      expect(route[0].from).toBe(WETH_ADDRESS);
    });

    it("passes stable flag to the route", async () => {
      mockRouter.getAmountsOut.mockResolvedValue([1000n, 2000n]);
      await service.getQuote("0xTokenIn", "0xTokenOut", 1000n, true);
      const route = mockRouter.getAmountsOut.mock.calls[0][1];
      expect(route[0].stable).toBe(true);
    });

    it("includes factory address from protocol config in route", async () => {
      mockRouter.getAmountsOut.mockResolvedValue([100n, 200n]);
      await service.getQuote("0xTokenIn", "0xTokenOut", 100n, false);
      const route = mockRouter.getAmountsOut.mock.calls[0][1];
      expect(route[0].factory).toBe("0xFactory");
    });
  });

  // ── checkAllowance ───────────────────────────────────────────────────────────

  describe("checkAllowance", () => {
    const mockERC20 = { allowance: vi.fn() };

    beforeEach(() => {
      mockGetContract.mockReturnValue(mockERC20 as never);
    });

    it("returns sufficient=true when allowance >= required", async () => {
      mockERC20.allowance.mockResolvedValue(1000n);
      const { allowance, sufficient } = await service.checkAllowance(
        "0xToken", "0xOwner", "0xSpender", 500n
      );
      expect(allowance).toBe(1000n);
      expect(sufficient).toBe(true);
    });

    it("returns sufficient=false when allowance < required", async () => {
      mockERC20.allowance.mockResolvedValue(100n);
      const { sufficient } = await service.checkAllowance(
        "0xToken", "0xOwner", "0xSpender", 500n
      );
      expect(sufficient).toBe(false);
    });

    it("returns sufficient=true when allowance equals required exactly", async () => {
      mockERC20.allowance.mockResolvedValue(500n);
      const { sufficient } = await service.checkAllowance(
        "0xToken", "0xOwner", "0xSpender", 500n
      );
      expect(sufficient).toBe(true);
    });

    it("calls allowance with correct owner and spender", async () => {
      mockERC20.allowance.mockResolvedValue(0n);
      await service.checkAllowance("0xToken", "0xOwner", "0xSpender", 1n);
      expect(mockERC20.allowance).toHaveBeenCalledWith("0xOwner", "0xSpender");
    });
  });
});
