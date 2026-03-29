import { ethers } from "ethers";
import { getEnabledStakingPools } from "../config/staking-pools";
import { getContract } from "../../../providers/chain.provider";
import { ERC20_ABI, POOL_ABI } from "../../../utils/abi";
import { BASE_TOKENS } from "../../../config/protocols";
import { aerodromeService } from "../../../shared/services/aerodrome.service";
import { createCache, getCached, setCache, getStale, type TTLCache } from "../../../shared/cache";

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
  stale?: boolean;
  lastUpdated?: string;
}

const portfolioCache = createCache<GetPortfolioResponse>();
const PORTFOLIO_CACHE_TTL = 30_000; // 30s

async function resolvePoolAndGauge(
  pool: ReturnType<typeof getEnabledStakingPools>[number]
): Promise<{ poolAddress: string; gaugeAddress: string } | null> {
  try {
    return await aerodromeService.resolvePoolAndGauge(pool);
  } catch {
    return null;
  }
}

export async function executeGetPortfolio(userAddress: string): Promise<GetPortfolioResponse> {
  const cacheKey = userAddress.toLowerCase();

  const cached = getCached(portfolioCache, cacheKey);
  if (cached) return cached;

  try {
    const data = await fetchPortfolioFresh(userAddress);
    setCache(portfolioCache, cacheKey, data, PORTFOLIO_CACHE_TTL);
    return data;
  } catch (err) {
    // On failure, return stale cache if available
    const stale = getStale(portfolioCache, cacheKey);
    if (stale) {
      console.warn(`[PORTFOLIO] Fetch failed for ${userAddress}, returning stale data from ${stale.value.lastUpdated} —`, err instanceof Error ? err.message : err);
      return { ...stale.value, stale: true };
    }
    throw err;
  }
}

async function fetchPortfolioFresh(userAddress: string): Promise<GetPortfolioResponse> {
  const enabledPools = getEnabledStakingPools();

  // Run wallet balances, adapter lookup, and pool resolution ALL in parallel
  const tokens = ["WETH", "USDC", "AERO"];
  const walletBalances: Record<string, string> = {};

  const balancePromises = tokens.map(async (symbol) => {
    const token = BASE_TOKENS[symbol];
    if (!token) return;
    try {
      const contract = getContract(token.address, ERC20_ABI, "base");
      const bal: bigint = await aerodromeService.withRetry(
        () => aerodromeService.withTimeout(() => contract.balanceOf(userAddress) as Promise<bigint>, 2500),
        1, 250,
      );
      const formatted = ethers.formatUnits(bal, token.decimals);
      walletBalances[symbol] = formatted;
      aerodromeService.setWalletBalanceCached(userAddress, symbol, formatted);
    } catch (err) {
      const cached = aerodromeService.getWalletBalanceCached(userAddress, symbol);
      if (cached !== null) {
        walletBalances[symbol] = cached;
        console.warn(
          `[PORTFOLIO] balance lookup failed for ${symbol} user=${userAddress}; using cached value=${cached}`
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

  const adapterPromise = aerodromeService.getUserAdapterAddress(userAddress, "aerodrome");

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

  // Fetch staking positions for resolved pools (in parallel)
  const assets: PortfolioAsset[] = [];
  const positionPromises = poolResults.filter(Boolean).map(async (result) => {
    const { pool, poolAddress, gaugeAddress } = result!;
    try {
      const totalStaked = userAdapter
        ? await aerodromeService.withRetry(() => aerodromeService.getStakedBalance(gaugeAddress, userAdapter), 2, 300).catch(() => 0n)
        : 0n;
      const totalEarned = userAdapter
        ? await aerodromeService.withRetry(() => aerodromeService.getEarnedRewards(gaugeAddress, userAdapter), 2, 300).catch(() => 0n)
        : 0n;

      console.log(`[PORTFOLIO] ${pool.name}: staked=${totalStaked}, earned=${totalEarned}`);

      if (totalStaked > 0n) {
        const poolContract = getContract(poolAddress, POOL_ABI, "base");
        let reserveA = 0n, reserveB = 0n, totalSupply = 0n;
        try {
          const lpToken = getContract(poolAddress, ERC20_ABI, "base");
          const [[reserve0, reserve1], supply, token0] = await Promise.all([
            aerodromeService.withTimeout(() => poolContract.getReserves() as Promise<[bigint, bigint]>),
            aerodromeService.withTimeout(() => lpToken.totalSupply() as Promise<bigint>),
            aerodromeService.withTimeout(() => poolContract.token0() as Promise<string>),
          ]);
          totalSupply = supply;
          const isTokenAFirst = pool.tokenA.address.toLowerCase() === token0.toLowerCase();
          reserveA = isTokenAFirst ? reserve0 : reserve1;
          reserveB = isTokenAFirst ? reserve1 : reserve0;
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
    lastUpdated: new Date().toISOString(),
  };
}
