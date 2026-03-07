import { ethers } from "ethers";
import { getEnabledSwapPairs } from "../config/swap-pairs";
import { getPoolAddress, getPoolInfo } from "../../../providers/aerodrome.provider";

interface SwapPairInfo {
  id: string;
  tokenIn: { symbol: string; address: string; decimals: number };
  tokenOut: { symbol: string; address: string; decimals: number };
  stable: boolean;
  poolAddress: string;
  reserve0: string;
  reserve1: string;
}

export interface GetSwapPairsResponse {
  pairs: SwapPairInfo[];
}

export async function executeGetSwapPairs(): Promise<GetSwapPairsResponse> {
  const enabledPairs = getEnabledSwapPairs();
  const pairs: SwapPairInfo[] = [];

  for (const pair of enabledPairs) {
    try {
      const poolAddress = await getPoolAddress(pair.tokenIn.address, pair.tokenOut.address, pair.stable);
      if (poolAddress === ethers.ZeroAddress) continue;

      const info = await getPoolInfo(poolAddress);

      pairs.push({
        id: pair.id,
        tokenIn: pair.tokenIn,
        tokenOut: pair.tokenOut,
        stable: pair.stable,
        poolAddress,
        reserve0: info.reserve0,
        reserve1: info.reserve1,
      });
    } catch {
      // Skip pairs that fail to load
    }
  }

  return { pairs };
}
