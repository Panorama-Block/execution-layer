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
    const { allowance } = await aerodromeService.checkAllowance(tokenIn, userAddress, executorAddress, amountIn);
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
