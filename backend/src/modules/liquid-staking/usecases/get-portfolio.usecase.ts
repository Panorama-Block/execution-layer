import { ethers } from "ethers";
import { getEnabledStakingPools } from "../config/staking-pools";
import { getPoolAddress } from "../../../providers/aerodrome.provider";
import { getGaugeForPool, getStakedBalance, getEarnedRewards } from "../../../providers/gauge.provider";
import { getContract } from "../../../providers/chain.provider";
import { ERC20_ABI, POOL_ABI } from "../../../utils/abi";
import { getProtocolConfig } from "../../../config/protocols";

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

async function safeBigInt(fn: () => Promise<bigint>): Promise<bigint> {
  try { return await fn(); } catch { return 0n; }
}

export async function executeGetPortfolio(userAddress: string): Promise<GetPortfolioResponse> {
  const enabledPools = getEnabledStakingPools();
  const adapterAddress = getProtocolConfig("aerodrome").adapterAddress;
  const assets: PortfolioAsset[] = [];

  // Get wallet balances for common tokens
  const tokens = ["WETH", "USDC", "AERO"];
  const { BASE_TOKENS } = await import("../../../config/protocols");
  const walletBalances: Record<string, string> = {};

  const balancePromises = tokens.map(async (symbol) => {
    const token = BASE_TOKENS[symbol];
    if (!token) return;
    try {
      const contract = getContract(token.address, ERC20_ABI, "base");
      const bal: bigint = await contract.balanceOf(userAddress);
      walletBalances[symbol] = ethers.formatUnits(bal, token.decimals);
    } catch {
      walletBalances[symbol] = "0";
    }
  });

  await Promise.all(balancePromises);

  for (const pool of enabledPools) {
    try {
      const poolAddress = await getPoolAddress(pool.tokenA.address, pool.tokenB.address, pool.stable);
      if (poolAddress === ethers.ZeroAddress) continue;

      const gaugeAddress = await getGaugeForPool(poolAddress);
      if (gaugeAddress === ethers.ZeroAddress) continue;

      const [adapterStaked, adapterEarned, userStaked, userEarned] = await Promise.all([
        adapterAddress ? safeBigInt(() => getStakedBalance(gaugeAddress, adapterAddress)) : Promise.resolve(0n),
        adapterAddress ? safeBigInt(() => getEarnedRewards(gaugeAddress, adapterAddress)) : Promise.resolve(0n),
        safeBigInt(() => getStakedBalance(gaugeAddress, userAddress)),
        safeBigInt(() => getEarnedRewards(gaugeAddress, userAddress)),
      ]);

      const totalStaked = adapterStaked + userStaked;
      const totalEarned = adapterEarned + userEarned;

      if (totalStaked > 0n) {
        // Estimate underlying token balances from LP (simplified — 50/50 split for volatile)
        const poolContract = getContract(poolAddress, POOL_ABI, "base");
        let reserveA = 0n, reserveB = 0n, totalSupply = 0n;
        try {
          [reserveA, reserveB] = await poolContract.getReserves();
          const lpToken = getContract(poolAddress, ERC20_ABI, "base");
          totalSupply = await lpToken.totalSupply() as bigint;
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
  }

  return {
    userAddress,
    totalPositions: assets.length,
    assets,
    walletBalances,
  };
}
