import { ethers } from "ethers";
import { aerodromeService } from "./services/aerodrome.service";
import { BundleBuilder, ADAPTER_SELECTORS } from "./bundle-builder";
import { encodeProtocolId, isNativeETH } from "../utils/encoding";

export interface AerodromeSwapBundleParams {
  userAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOutMin: bigint;
  stable: boolean;
  deadline: number;
  executorAddress: string;
  chainId: number;
}

/**
 * Builds an Aerodrome swap bundle (approve if needed + execute).
 * Shared between the internal swap module and the swap-provider adapter.
 */
export async function buildAerodromeSwapBundle(
  params: AerodromeSwapBundleParams
): Promise<BundleBuilder> {
  const { userAddress, tokenIn, tokenOut, amountIn, amountOutMin, stable, deadline, executorAddress, chainId } = params;

  const builder    = new BundleBuilder(chainId);
  const protocolId = encodeProtocolId("aerodrome");

  let ethValue = 0n;
  if (isNativeETH(tokenIn)) {
    ethValue = amountIn;
  } else {
    // Read allowance and balance concurrently with a hard 3 s timeout.
    // In production the public Base RPC can take 5-7 s per call; retrying triples the wait
    // and leaves the quote stale (increasing slippage risk). With a short timeout:
    //   - allowance failure → assume 0 → add approve step (safe, slightly more gas)
    //   - balance failure   → skip check → executor reverts on-chain if truly insufficient
    const [allowanceResult, balanceResult] = await Promise.allSettled([
      aerodromeService.withTimeout(() => aerodromeService.checkAllowance(tokenIn, userAddress, executorAddress, amountIn), 3000),
      aerodromeService.withTimeout(() => aerodromeService.getTokenBalance(tokenIn, userAddress), 3000),
    ]);

    const allowance = allowanceResult.status === "fulfilled" ? allowanceResult.value.allowance : 0n;
    if (allowanceResult.status === "rejected") {
      console.warn(`[aerodrome-swap] allowance read failed — assuming 0 (will add approve step): ${(allowanceResult.reason as Error)?.message}`);
    }

    if (balanceResult.status === "fulfilled") {
      const balance = balanceResult.value;
      if (balance < amountIn) {
        throw new Error(`Insufficient token balance: have ${balance}, need ${amountIn}`);
      }
    } else {
      console.warn(`[aerodrome-swap] balance read failed — skipping check, executor will revert if insufficient: ${(balanceResult.reason as Error)?.message}`);
    }

    builder.addApproveIfNeeded(tokenIn, executorAddress, allowance, amountIn, "Approve token for swap");
  }

  const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint256", "uint256", "address", "bool"],
    [tokenIn, tokenOut, amountIn, amountOutMin, userAddress, stable]
  );

  const transfers = isNativeETH(tokenIn) ? [] : [{ token: tokenIn, amount: amountIn }];

  builder.addExecute(
    protocolId, ADAPTER_SELECTORS.SWAP,
    transfers, deadline, adapterData, ethValue,
    executorAddress, "Swap via Aerodrome"
  );

  return builder;
}
