import { ethers } from "ethers";
import { getEnabledStakingPools } from "../config/staking-pools";
import { getPoolAddress } from "../../../providers/aerodrome.provider";
import { getGaugeForPool, getStakedBalance, getEarnedRewards } from "../../../providers/gauge.provider";
import { getContract } from "../../../providers/chain.provider";
import { ERC20_ABI, POOL_ABI } from "../../../utils/abi";
import { getUserAdapterAddress } from "../../../config/protocols";

interface PortfolioAsset {
  poolId: string;
  poolName: string;
  tokenA: { symbol: string; address: string; balance: string };
  tokenB: { symbol: string; address: string; balance: string };
  lpStaked: string;
  pendingRewards: string;
  rewardTokenSymbol: string;
}

export interface GetPortfolioResponse {
  userAddress: string;
  totalPositions: number;
  assets: PortfolioAsset[];
  walletBalances: Record<string, string>;
}

const BALANCE_CACHE_TTL_MS = 90_000;
const walletBalanceCache = new Map<string, { value: string; expiresAt: number }>();

function getWalletBalanceCacheKey(userAddress: string, symbol: string): string {
  return `${userAddress.toLowerCase()}:${symbol.toUpperCase()}`;
}

function getCachedWalletBalance(userAddress: string, symbol: string): string | null {
  const key = getWalletBalanceCacheKey(userAddress, symbol);
  const cached = walletBalanceCache.get(key);
  if (!cached) return null;
  if (Date.now() >= cached.expiresAt) {
    walletBalanceCache.delete(key);
    return null;
  }
  return cached.value;
}

function setCachedWalletBalance(userAddress: string, symbol: string, value: string): void {
  const key = getWalletBalanceCacheKey(userAddress, symbol);
  walletBalanceCache.set(key, {
    value,
    expiresAt: Date.now() + BALANCE_CACHE_TTL_MS,
  });
}

function withTimeout<T>(fn: () => Promise<T>, ms = 3500): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 500): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("retry failed");
}

async function safeBigInt(fn: () => Promise<bigint>): Promise<bigint> {
  try { return await withTimeout(fn); } catch { return 0n; }
}

async function resolvePoolAndGauge(pool: ReturnType<typeof getEnabledStakingPools>[number]): Promise<{ poolAddress: string; gaugeAddress: string } | null> {
  try {
    const poolAddress = pool.poolAddress && pool.poolAddress !== ethers.ZeroAddress
      ? pool.poolAddress
      : await withTimeout(() => getPoolAddress(pool.tokenA.address, pool.tokenB.address, pool.stable));
    if (!poolAddress || poolAddress === ethers.ZeroAddress) return null;

    const gaugeAddress = pool.gaugeAddress && pool.gaugeAddress !== ethers.ZeroAddress
      ? pool.gaugeAddress
      : await withTimeout(() => getGaugeForPool(poolAddress));
    if (!gaugeAddress || gaugeAddress === ethers.ZeroAddress) return null;

    return { poolAddress, gaugeAddress };
  } catch {
    return null;
  }
}

export async function executeGetPortfolio(userAddress: string): Promise<GetPortfolioResponse> {
  const enabledPools = getEnabledStakingPools();
  const { BASE_TOKENS } = await import("../../../config/protocols");

  // Run wallet balances, adapter lookup, and pool resolution ALL in parallel
  const tokens = ["WETH", "USDC", "AERO"];
  const walletBalances: Record<string, string> = {};

  const balancePromises = tokens.map(async (symbol) => {
    const token = BASE_TOKENS[symbol];
    if (!token) return;
    try {
      const contract = getContract(token.address, ERC20_ABI, "base");
      const bal: bigint = await withRetry(
        () => withTimeout(() => contract.balanceOf(userAddress) as Promise<bigint>, 2500),
        1,
        250,
      );
      const formatted = ethers.formatUnits(bal, token.decimals);
      walletBalances[symbol] = formatted;
      setCachedWalletBalance(userAddress, symbol, formatted);
    } catch (err) {
      const cached = getCachedWalletBalance(userAddress, symbol);
      if (cached !== null) {
        walletBalances[symbol] = cached;
        console.warn(
          `[PORTFOLIO] balance lookup failed for ${symbol} user=${userAddress}; using cached value=${cached}`,
        );
        return;
      }
      console.warn(
        `[PORTFOLIO] balance lookup failed for ${symbol} user=${userAddress}:`,
        err instanceof Error ? err.message : err
      );
      walletBalances[symbol] = "0";
    }
  });

  const adapterPromise = getUserAdapterAddress(userAddress, "aerodrome");

  const poolDataPromises = enabledPools.map(async (pool) => {
    const resolved = await resolvePoolAndGauge(pool);
    if (!resolved) return null;
    return { pool, ...resolved };
  });

  const [, userAdapter, poolResults] = await Promise.all([
    Promise.all(balancePromises),
    adapterPromise,
    Promise.all(poolDataPromises),
  ]);

  console.log(`[PORTFOLIO] user=${userAddress}, adapter=${userAdapter}, resolvedPools=${poolResults.filter(Boolean).length}`);

  // Now fetch staking positions for resolved pools (in parallel)
  const assets: PortfolioAsset[] = [];
  const positionPromises = poolResults.filter(Boolean).map(async (result) => {
    const { pool, poolAddress, gaugeAddress } = result!;
    try {
      const totalStaked = userAdapter
        ? await safeBigInt(() => getStakedBalance(gaugeAddress, userAdapter))
        : 0n;
      const totalEarned = userAdapter
        ? await safeBigInt(() => getEarnedRewards(gaugeAddress, userAdapter))
        : 0n;

      console.log(`[PORTFOLIO] ${pool.name}: staked=${totalStaked}, earned=${totalEarned}`);

      if (totalStaked > 0n) {
        const poolContract = getContract(poolAddress, POOL_ABI, "base");
        let reserveA = 0n, reserveB = 0n, totalSupply = 0n;
        try {
          [reserveA, reserveB] = await withTimeout(() => poolContract.getReserves() as Promise<[bigint, bigint]>);
          const lpToken = getContract(poolAddress, ERC20_ABI, "base");
          totalSupply = await withTimeout(() => lpToken.totalSupply() as Promise<bigint>);
        } catch { /* skip reserve calc */ }

        let balA = "0", balB = "0";
        if (totalSupply > 0n) {
          balA = ethers.formatUnits((reserveA * totalStaked) / totalSupply, pool.tokenA.decimals);
          balB = ethers.formatUnits((reserveB * totalStaked) / totalSupply, pool.tokenB.decimals);
        }

        assets.push({
          poolId: pool.id,
          poolName: pool.name,
          tokenA: { symbol: pool.tokenA.symbol, address: pool.tokenA.address, balance: balA },
          tokenB: { symbol: pool.tokenB.symbol, address: pool.tokenB.address, balance: balB },
          lpStaked: totalStaked.toString(),
          pendingRewards: ethers.formatUnits(totalEarned, pool.rewardToken.decimals),
          rewardTokenSymbol: pool.rewardToken.symbol,
        });
      }
    } catch {
      // Skip failed pools
    }
  });

  await Promise.all(positionPromises);

  return {
    userAddress,
    totalPositions: assets.length,
    assets,
    walletBalances,
  };
}
