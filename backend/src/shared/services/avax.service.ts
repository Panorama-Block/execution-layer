import { getContract } from "../../providers/chain.provider";
import { TRADER_JOE_ROUTER_ABI, ERC20_ABI, BENQI_TOKEN_ABI } from "../../utils/abi";

// ─── Avalanche C-Chain constants ────────────────────────────────────────────

const TRADER_JOE_ROUTER = "0x60aE616a2155Ee3d9A68541Ba4544862310933d4";
export const WAVAX        = "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7";

export const AVAX_TOKENS = {
  WAVAX:  { address: WAVAX,                                         symbol: "WAVAX",  decimals: 18 },
  USDC:   { address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", symbol: "USDC",   decimals: 6  },
  USDCe:  { address: "0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664", symbol: "USDC.e", decimals: 6  },
  USDT:   { address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", symbol: "USDT",   decimals: 6  },
  WETH:   { address: "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB", symbol: "WETH.e", decimals: 18 },
  BTCb:   { address: "0x152b9d0FdC40C096757F570A51E494bd4b943E50", symbol: "BTC.b",  decimals: 8  },
} as const;

export const BENQI_MARKETS = {
  qiAVAX: { address: "0x5C0401e81Bc07Ca70fAD469b451682c0d747Ef1c", symbol: "qiAVAX", underlyingSymbol: "AVAX",   isNative: true  },
  qiUSDCe:{ address: "0xBEb5d47A3f720Ec0a390d04b4d41ED7d9688bC7F", symbol: "qiUSDC", underlyingSymbol: "USDC.e", isNative: false },
  qiUSDT: { address: "0xc9e5999b8e75C3fEB117F6f73E664b9f3C8ca65C", symbol: "qiUSDT", underlyingSymbol: "USDT",   isNative: false },
  qiETH:  { address: "0x334AD834Cd4481BB02d09615E7c11a00579A7909", symbol: "qiETH",  underlyingSymbol: "WETH.e", isNative: false },
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function withTimeout<T>(fn: () => Promise<T>, ms = 10_000): Promise<T> {
  return Promise.race([fn(), new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), ms))]);
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2, delay = 500): Promise<T> {
  try { return await fn(); } catch (err) {
    if (retries <= 0) throw err;
    await new Promise(r => setTimeout(r, delay));
    return withRetry(fn, retries - 1, delay * 2);
  }
}

// ─── AvaxService ─────────────────────────────────────────────────────────────

class AvaxService {
  private get router() {
    return getContract(TRADER_JOE_ROUTER, TRADER_JOE_ROUTER_ABI, "avalanche");
  }

  // ─── Swap quotes ────────────────────────────────────────────────────────

  async getQuote(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<{ amountOut: bigint; path: string[] }> {
    return withRetry(() => withTimeout(async () => {
      const path = [tokenIn, tokenOut];
      const amounts: bigint[] = await this.router.getAmountsOut(amountIn, path);
      return { amountOut: amounts[amounts.length - 1], path };
    }));
  }

  async getQuoteWithHop(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<{ amountOut: bigint; path: string[] }> {
    return withRetry(() => withTimeout(async () => {
      // Multi-hop via WAVAX
      const path = tokenIn === WAVAX || tokenOut === WAVAX
        ? [tokenIn, tokenOut]
        : [tokenIn, WAVAX, tokenOut];
      const amounts: bigint[] = await this.router.getAmountsOut(amountIn, path);
      return { amountOut: amounts[amounts.length - 1], path };
    }));
  }

  // ─── Token data ─────────────────────────────────────────────────────────

  async getTokenBalance(tokenAddress: string, owner: string): Promise<bigint> {
    try {
      const token = getContract(tokenAddress, ERC20_ABI, "avalanche");
      return await withTimeout(() => token.balanceOf(owner) as Promise<bigint>);
    } catch { return 0n; }
  }

  async checkAllowance(token: string, owner: string, spender: string, _required: bigint): Promise<bigint> {
    try {
      const erc20 = getContract(token, ERC20_ABI, "avalanche");
      return await withTimeout(() => erc20.allowance(owner, spender) as Promise<bigint>);
    } catch { return 0n; }
  }

  // ─── Benqi market data ──────────────────────────────────────────────────

  async getQTokenBalance(qTokenAddress: string, owner: string): Promise<bigint> {
    try {
      const qToken = getContract(qTokenAddress, BENQI_TOKEN_ABI, "avalanche");
      return await withTimeout(() => qToken.balanceOf(owner) as Promise<bigint>);
    } catch { return 0n; }
  }

  async getSupplyRate(qTokenAddress: string): Promise<bigint> {
    try {
      const qToken = getContract(qTokenAddress, BENQI_TOKEN_ABI, "avalanche");
      return await withTimeout(() => qToken.supplyRatePerTimestamp() as Promise<bigint>);
    } catch { return 0n; }
  }

  async getBorrowRate(qTokenAddress: string): Promise<bigint> {
    try {
      const qToken = getContract(qTokenAddress, BENQI_TOKEN_ABI, "avalanche");
      return await withTimeout(() => qToken.borrowRatePerTimestamp() as Promise<bigint>);
    } catch { return 0n; }
  }

  getMarketByQToken(qTokenAddress: string) {
    return Object.values(BENQI_MARKETS).find(
      m => m.address.toLowerCase() === qTokenAddress.toLowerCase()
    );
  }
}

export const avaxService = new AvaxService();
