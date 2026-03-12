import { ethers } from "ethers";
import { getContract } from "./chain.provider";
import { getProtocolConfig } from "../config/protocols";
import { AERODROME_ROUTER_ABI, AERODROME_FACTORY_ABI, POOL_ABI, ERC20_ABI } from "../utils/abi";

const CHAIN = "base";
const WETH = "0x4200000000000000000000000000000000000006";
const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

interface Route {
  from: string;
  to: string;
  stable: boolean;
  factory: string;
}

interface PoolInfo {
  address: string;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  stable: boolean;
  reserve0: string;
  reserve1: string;
}

function resolveToken(address: string): string {
  return address === ETH_ADDRESS ? WETH : address;
}

export async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  stable: boolean = false
): Promise<{ amountOut: bigint; route: Route[] }> {
  const config = getProtocolConfig("aerodrome");
  const router = getContract(config.contracts.router, AERODROME_ROUTER_ABI, CHAIN);

  const resolvedIn = resolveToken(tokenIn);
  const resolvedOut = resolveToken(tokenOut);

  const route: Route[] = [
    {
      from: resolvedIn,
      to: resolvedOut,
      stable,
      factory: config.contracts.factory,
    },
  ];

  const amounts: bigint[] = await router.getAmountsOut(amountIn, route);
  const amountOut = amounts[amounts.length - 1];

  return { amountOut, route };
}

export async function getPoolAddress(
  tokenA: string,
  tokenB: string,
  stable: boolean
): Promise<string> {
  const config = getProtocolConfig("aerodrome");
  const factory = getContract(config.contracts.factory, AERODROME_FACTORY_ABI, CHAIN);
  return factory.getPool(resolveToken(tokenA), resolveToken(tokenB), stable);
}

export async function getPoolInfo(poolAddress: string): Promise<PoolInfo> {
  const pool = getContract(poolAddress, POOL_ABI, CHAIN);

  const [token0, token1, stable, reserves] = await Promise.all([
    pool.token0() as Promise<string>,
    pool.token1() as Promise<string>,
    pool.stable() as Promise<boolean>,
    pool.getReserves() as Promise<[bigint, bigint, bigint]>,
  ]);

  const token0Contract = getContract(token0, ERC20_ABI, CHAIN);
  const token1Contract = getContract(token1, ERC20_ABI, CHAIN);

  const [token0Symbol, token1Symbol] = await Promise.all([
    token0Contract.symbol() as Promise<string>,
    token1Contract.symbol() as Promise<string>,
  ]);

  return {
    address: poolAddress,
    token0,
    token1,
    token0Symbol,
    token1Symbol,
    stable,
    reserve0: reserves[0].toString(),
    reserve1: reserves[1].toString(),
  };
}

export async function getPopularPools(): Promise<PoolInfo[]> {
  const popularPairs: Array<{ tokenA: string; tokenB: string; stable: boolean }> = [
    { tokenA: WETH, tokenB: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", stable: false }, // WETH/USDC volatile
    { tokenA: WETH, tokenB: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", stable: false }, // WETH/AERO volatile
    { tokenA: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", tokenB: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", stable: true }, // USDC/USDbC stable
  ];

  const pools: PoolInfo[] = [];

  for (const pair of popularPairs) {
    try {
      const poolAddr = await getPoolAddress(pair.tokenA, pair.tokenB, pair.stable);
      if (poolAddr !== ethers.ZeroAddress) {
        const info = await getPoolInfo(poolAddr);
        pools.push(info);
      }
    } catch {
      // Skip pools that fail to load
    }
  }

  return pools;
}
