import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../shared/services/aerodrome.service", () => ({
  aerodromeService: {
    getQuote: vi.fn(),
  },
}));

import { aerodromeService } from "../../../shared/services/aerodrome.service";
import { executeGetSwapQuote } from "../../../modules/swap/usecases/get-quote.usecase";

const mockGetQuote = vi.mocked(aerodromeService.getQuote);

const TOKEN_IN  = "0x4200000000000000000000000000000000000006"; // WETH
const TOKEN_OUT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC

describe("executeGetSwapQuote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns amountOut from service", async () => {
    mockGetQuote.mockResolvedValue({ amountOut: 2000n, route: [] });
    const result = await executeGetSwapQuote({
      tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "1000",
    });
    expect(result.amountOut).toBe("2000");
  });

  it("applies default 50bps slippage to amountOutMin", async () => {
    mockGetQuote.mockResolvedValue({ amountOut: 10000n, route: [] });
    const result = await executeGetSwapQuote({
      tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "5000",
    });
    // 10000 * (10000 - 50) / 10000 = 9950
    expect(result.amountOutMin).toBe("9950");
  });

  it("applies custom slippageBps", async () => {
    mockGetQuote.mockResolvedValue({ amountOut: 10000n, route: [] });
    const result = await executeGetSwapQuote({
      tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "5000", slippageBps: 100,
    });
    // 10000 * (10000 - 100) / 10000 = 9900
    expect(result.amountOutMin).toBe("9900");
  });

  it("returns correct exchangeRate", async () => {
    mockGetQuote.mockResolvedValue({ amountOut: 2000n, route: [] });
    const result = await executeGetSwapQuote({
      tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "1000",
    });
    expect(result.exchangeRate).toBe("2.00000000");
  });

  it("returns exchangeRate '0' when amountIn is 0", async () => {
    mockGetQuote.mockResolvedValue({ amountOut: 0n, route: [] });
    const result = await executeGetSwapQuote({
      tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "0",
    });
    expect(result.exchangeRate).toBe("0");
  });

  it("passes stable flag to service", async () => {
    mockGetQuote.mockResolvedValue({ amountOut: 100n, route: [] });
    await executeGetSwapQuote({
      tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "100", stable: true,
    });
    expect(mockGetQuote).toHaveBeenCalledWith(TOKEN_IN, TOKEN_OUT, 100n, true);
  });

  it("defaults stable to false", async () => {
    mockGetQuote.mockResolvedValue({ amountOut: 100n, route: [] });
    await executeGetSwapQuote({
      tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "100",
    });
    expect(mockGetQuote).toHaveBeenCalledWith(TOKEN_IN, TOKEN_OUT, 100n, false);
  });

  it("returns tokenIn, tokenOut, amountIn in response", async () => {
    mockGetQuote.mockResolvedValue({ amountOut: 500n, route: [] });
    const result = await executeGetSwapQuote({
      tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "250",
    });
    expect(result.tokenIn).toBe(TOKEN_IN);
    expect(result.tokenOut).toBe(TOKEN_OUT);
    expect(result.amountIn).toBe("250");
  });

  // ===== stable: "auto" =====

  describe('stable: "auto"', () => {
    it("returns volatile result when volatile > stable", async () => {
      mockGetQuote
        .mockResolvedValueOnce({ amountOut: 2000n, route: [] }) // volatile
        .mockResolvedValueOnce({ amountOut: 1500n, route: [] }); // stable

      const result = await executeGetSwapQuote({
        tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "1000", stable: "auto",
      });

      expect(result.stable).toBe(false);
      expect(result.amountOut).toBe("2000");
    });

    it("returns stable result when stable > volatile", async () => {
      mockGetQuote
        .mockResolvedValueOnce({ amountOut: 900n, route: [] })  // volatile
        .mockResolvedValueOnce({ amountOut: 1200n, route: [] }); // stable

      const result = await executeGetSwapQuote({
        tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "1000", stable: "auto",
      });

      expect(result.stable).toBe(true);
      expect(result.amountOut).toBe("1200");
    });

    it("uses volatile when stable pool throws", async () => {
      mockGetQuote
        .mockResolvedValueOnce({ amountOut: 2000n, route: [] }) // volatile succeeds
        .mockRejectedValueOnce(new Error("no stable pool"));     // stable fails

      const result = await executeGetSwapQuote({
        tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "1000", stable: "auto",
      });

      expect(result.stable).toBe(false);
      expect(result.amountOut).toBe("2000");
    });

    it("uses stable when volatile pool throws", async () => {
      mockGetQuote
        .mockRejectedValueOnce(new Error("no volatile pool"))    // volatile fails
        .mockResolvedValueOnce({ amountOut: 1800n, route: [] }); // stable succeeds

      const result = await executeGetSwapQuote({
        tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "1000", stable: "auto",
      });

      expect(result.stable).toBe(true);
      expect(result.amountOut).toBe("1800");
    });

    it("throws when both pools throw", async () => {
      mockGetQuote.mockRejectedValue(new Error("no pool"));

      await expect(
        executeGetSwapQuote({ tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "1000", stable: "auto" })
      ).rejects.toThrow("No liquidity available on Aerodrome for this pair");
    });

    it("calls getQuote twice (volatile then stable)", async () => {
      mockGetQuote.mockResolvedValue({ amountOut: 100n, route: [] });

      await executeGetSwapQuote({
        tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "100", stable: "auto",
      });

      expect(mockGetQuote).toHaveBeenCalledTimes(2);
      expect(mockGetQuote).toHaveBeenNthCalledWith(1, TOKEN_IN, TOKEN_OUT, 100n, false);
      expect(mockGetQuote).toHaveBeenNthCalledWith(2, TOKEN_IN, TOKEN_OUT, 100n, true);
    });

    it("returned stable field is boolean (resolved), not 'auto'", async () => {
      mockGetQuote.mockResolvedValue({ amountOut: 100n, route: [] });

      const result = await executeGetSwapQuote({
        tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "100", stable: "auto",
      });

      expect(typeof result.stable).toBe("boolean");
    });
  });
});
