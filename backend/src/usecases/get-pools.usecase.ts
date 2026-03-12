import { getPopularPools, getPoolInfo, getPoolAddress } from "../providers/aerodrome.provider";

export interface PoolsResponse {
  pools: Array<{
    address: string;
    token0: string;
    token1: string;
    token0Symbol: string;
    token1Symbol: string;
    stable: boolean;
    reserve0: string;
    reserve1: string;
  }>;
}

export async function executeGetPools(): Promise<PoolsResponse> {
  const pools = await getPopularPools();
  return { pools };
}

export interface PoolDetailRequest {
  tokenA: string;
  tokenB: string;
  stable?: boolean;
}

export async function executeGetPoolDetail(req: PoolDetailRequest): Promise<PoolsResponse["pools"][0] | null> {
  const stable = req.stable ?? false;
  const poolAddress = await getPoolAddress(req.tokenA, req.tokenB, stable);

  if (poolAddress === "0x0000000000000000000000000000000000000000") {
    return null;
  }

  return getPoolInfo(poolAddress);
}
