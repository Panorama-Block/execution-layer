import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { encodeProtocolId, getDeadline, isNativeETH, applySlippage } from "../../../utils/encoding";
import { TransactionBundle } from "../../../types/transaction";
import { aerodromeService } from "../../../shared/services/aerodrome.service";
import { BundleBuilder, ADAPTER_SELECTORS } from "../../../shared/bundle-builder";

export interface PrepareSwapRequest {
  userAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  stable?: boolean;
  slippageBps?: number;
  deadlineMinutes?: number;
}

export interface PrepareSwapResponse {
  bundle: TransactionBundle;
  metadata: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut: string;
    amountOutMin: string;
    stable: boolean;
    slippageBps: number;
    priceImpact: string;
  };
}

export async function executePrepareSwapBundle(
  req: PrepareSwapRequest
): Promise<PrepareSwapResponse> {
  const chain           = getChainConfig("base");
  const executorAddress = chain.contracts.panoramaExecutor;
  const amountIn        = BigInt(req.amountIn);
  const stable          = req.stable ?? false;
  const slippageBps     = req.slippageBps ?? 50;
  const deadlineMinutes = req.deadlineMinutes ?? 20;

  // Get quote on-chain
  const { amountOut } = await aerodromeService.getQuote(req.tokenIn, req.tokenOut, amountIn, stable);
  const amountOutMin  = applySlippage(amountOut, slippageBps);

  const protocolId = encodeProtocolId("aerodrome");
  const deadline   = getDeadline(deadlineMinutes);
  const builder    = new BundleBuilder(chain.chainId);

  // Step 1 - Approve tokenIn to Executor (if not native ETH, check allowance first)
  let ethValue = 0n;
  if (isNativeETH(req.tokenIn)) {
    ethValue = amountIn;
  } else {
    const { allowance } = await aerodromeService.checkAllowance(
      req.tokenIn, req.userAddress, executorAddress, amountIn
    );
    builder.addApproveIfNeeded(
      req.tokenIn, executorAddress, allowance, amountIn,
      "Approve token for swap"
    );
  }

  // Step 2 - Execute swap via PanoramaExecutor.execute()
  const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint256", "uint256", "address", "bool"],
    [req.tokenIn, req.tokenOut, amountIn, amountOutMin, req.userAddress, stable]
  );

  const transfers = isNativeETH(req.tokenIn)
    ? []
    : [{ token: req.tokenIn, amount: amountIn }];

  builder.addExecute(
    protocolId, ADAPTER_SELECTORS.SWAP,
    transfers, deadline, adapterData, ethValue,
    executorAddress, `Swap via Aerodrome`
  );

  const priceImpact =
    amountIn > 0n
      ? (100 - (Number(amountOut) / Number(amountIn)) * 100).toFixed(4)
      : "0";

  return {
    bundle: builder.build(`Swap via Aerodrome (${stable ? "stable" : "volatile"} pool)`),
    metadata: {
      tokenIn: req.tokenIn,
      tokenOut: req.tokenOut,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      amountOutMin: amountOutMin.toString(),
      stable,
      slippageBps,
      priceImpact,
    },
  };
}
