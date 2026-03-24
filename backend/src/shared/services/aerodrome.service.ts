import { ethers } from "ethers";
import { getContract } from "../../providers/chain.provider";
import { getProtocolConfig, getUserAdapterAddress } from "../../config/protocols";
import {
  AERODROME_ROUTER_ABI,
  AERODROME_FACTORY_ABI,
  POOL_ABI,
  ERC20_ABI,
  GAUGE_ABI,
  VOTER_ABI,
} from "../../utils/abi";

const CHAIN = "base";
const WETH = "0x4200000000000000000000000000000000000006";
const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

interface Route {
  from: string;
  to: string;
  stable: boolean;
  factory: string;
}

const BALANCE_CACHE_TTL_MS = 90_000;
const walletBalanceCache = new Map<string, { value: string; expiresAt: number }>();

function resolveTokenAddress(address: string): string {
  return address === ETH_ADDRESS ? WETH : address;
}

export class AerodromeService {
  readonly protocolId = ethers.keccak256(ethers.toUtf8Bytes("aerodrome"));

  // Delegate to protocols.ts — already has caching + retry + in-flight dedup
  getUserAdapterAddress = getUserAdapterAddress;

  // ========== RESILIENCE ==========

  async withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 500): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error("retry failed");
  }

  withTimeout<T>(fn: () => Promise<T>, ms = 3500): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
    ]);
  }

  async safeBigInt(fn: () => Promise<bigint>): Promise<bigint> {
    try {
      return await this.withTimeout(fn);
    } catch {
      return 0n;
    }
  }

  // ========== QUOTE ==========

  async getQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    stable = false
  ): Promise<{ amountOut: bigint; route: Route[] }> {
    const config = getProtocolConfig("aerodrome");
    const router = getContract(config.contracts.router, AERODROME_ROUTER_ABI, CHAIN);

    const resolvedIn  = resolveTokenAddress(tokenIn);
    const resolvedOut = resolveTokenAddress(tokenOut);

    const route: Route[] = [{
      from: resolvedIn,
      to: resolvedOut,
      stable,
      factory: config.contracts.factory,
    }];

    const amounts: bigint[] = await router.getAmountsOut(amountIn, route);
    return { amountOut: amounts[amounts.length - 1], route };
  }

  // ========== POOL ==========

  async getPoolAddress(tokenA: string, tokenB: string, stable: boolean): Promise<string> {
    const config = getProtocolConfig("aerodrome");
    const factory = getContract(config.contracts.factory, AERODROME_FACTORY_ABI, CHAIN);
    return factory.getPool(resolveTokenAddress(tokenA), resolveTokenAddress(tokenB), stable);
  }

  async resolvePoolAndGauge(poolConfig: {
    poolAddress?: string;
    gaugeAddress?: string;
    tokenA: { address: string };
    tokenB: { address: string };
    stable: boolean;
    name: string;
  }): Promise<{ poolAddress: string; gaugeAddress: string }> {
    const poolAddress =
      poolConfig.poolAddress && poolConfig.poolAddress !== ethers.ZeroAddress
        ? poolConfig.poolAddress
        : await this.withRetry(() =>
            this.getPoolAddress(poolConfig.tokenA.address, poolConfig.tokenB.address, poolConfig.stable)
          );

    if (!poolAddress || poolAddress === ethers.ZeroAddress) {
      throw new Error(`Pool not found on-chain for ${poolConfig.name}`);
    }

    const gaugeAddress =
      poolConfig.gaugeAddress && poolConfig.gaugeAddress !== ethers.ZeroAddress
        ? poolConfig.gaugeAddress
        : await this.withRetry(() => this.getGaugeForPool(poolAddress));

    if (!gaugeAddress || gaugeAddress === ethers.ZeroAddress) {
      throw new Error(`Gauge not found for pool ${poolConfig.name}`);
    }

    return { poolAddress, gaugeAddress };
  }

  // ========== GAUGE ==========

  async getPoolInfo(poolAddress: string): Promise<{
    address: string;
    token0: string;
    token1: string;
    token0Symbol: string;
    token1Symbol: string;
    stable: boolean;
    reserve0: string;
    reserve1: string;
  }> {
    const pool = getContract(poolAddress, POOL_ABI, CHAIN);
    const [token0, token1, stable, reserves] = await Promise.all([
      pool.token0() as Promise<string>,
      pool.token1() as Promise<string>,
      pool.stable() as Promise<boolean>,
      pool.getReserves() as Promise<[bigint, bigint, bigint]>,
    ]);
    const t0 = getContract(token0, ERC20_ABI, CHAIN);
    const t1 = getContract(token1, ERC20_ABI, CHAIN);
    const [token0Symbol, token1Symbol] = await Promise.all([
      t0.symbol() as Promise<string>,
      t1.symbol() as Promise<string>,
    ]);
    return {
      address: poolAddress, token0, token1, token0Symbol, token1Symbol,
      stable, reserve0: reserves[0].toString(), reserve1: reserves[1].toString(),
    };
  }

  async getGaugeForPool(poolAddress: string): Promise<string> {
    const config = getProtocolConfig("aerodrome");
    const voter = getContract(config.contracts.voter, VOTER_ABI, CHAIN);
    return voter.gauges(poolAddress);
  }

  async getStakedBalance(gaugeAddress: string, adapterAddress: string): Promise<bigint> {
    const gauge = getContract(gaugeAddress, GAUGE_ABI, CHAIN);
    return gauge.balanceOf(adapterAddress);
  }

  async getEarnedRewards(gaugeAddress: string, adapterAddress: string): Promise<bigint> {
    const gauge = getContract(gaugeAddress, GAUGE_ABI, CHAIN);
    return gauge.earned(adapterAddress);
  }

  async getRewardRate(gaugeAddress: string): Promise<bigint> {
    const gauge = getContract(gaugeAddress, GAUGE_ABI, CHAIN);
    return gauge.rewardRate();
  }

  // ========== ALLOWANCE ==========

  async checkAllowance(
    token: string,
    owner: string,
    spender: string,
    required: bigint
  ): Promise<{ allowance: bigint; sufficient: boolean }> {
    const contract = getContract(token, ERC20_ABI, CHAIN);
    const allowance: bigint = await contract.allowance(owner, spender);
    return { allowance, sufficient: allowance >= required };
  }

  // ========== LIQUIDITY QUOTE ==========

  async quoteAddLiquidity(
    tokenA: string,
    tokenB: string,
    stable: boolean,
    amountADesired: bigint,
    amountBDesired: bigint
  ): Promise<{ optimalA: bigint; optimalB: bigint; estimatedLiquidity: bigint }> {
    const config = getProtocolConfig("aerodrome");
    const router = getContract(config.contracts.router, AERODROME_ROUTER_ABI, CHAIN);
    const [optimalA, optimalB, estimatedLiquidity] = await router.quoteAddLiquidity(
      tokenA, tokenB, stable, config.contracts.factory, amountADesired, amountBDesired
    );
    return { optimalA, optimalB, estimatedLiquidity };
  }

  // ========== BALANCE ==========

  async getTokenBalance(token: string, owner: string): Promise<bigint> {
    const contract = getContract(token, ERC20_ABI, CHAIN);
    return contract.balanceOf(owner);
  }

  // ========== WALLET BALANCE CACHE (used by get-portfolio) ==========

  getWalletBalanceCached(userAddress: string, symbol: string): string | null {
    const key = `${userAddress.toLowerCase()}:${symbol.toUpperCase()}`;
    const cached = walletBalanceCache.get(key);
    if (!cached || Date.now() >= cached.expiresAt) {
      walletBalanceCache.delete(key);
      return null;
    }
    return cached.value;
  }

  setWalletBalanceCached(userAddress: string, symbol: string, value: string): void {
    const key = `${userAddress.toLowerCase()}:${symbol.toUpperCase()}`;
    walletBalanceCache.set(key, { value, expiresAt: Date.now() + BALANCE_CACHE_TTL_MS });
  }
}

export const aerodromeService = new AerodromeService();
