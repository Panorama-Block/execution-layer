import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { getQuote } from "../../../providers/aerodrome.provider";
import { getContract } from "../../../providers/chain.provider";
import { PANORAMA_EXECUTOR_ABI, ERC20_ABI } from "../../../utils/abi";
import {
  encodeProtocolId,
  encodeSwapExtraData,
  getDeadline,
  isNativeETH,
  applySlippage,
} from "../../../utils/encoding";
import { PreparedTransaction, TransactionBundle } from "../../../types/transaction";
import { formatExchangeRate } from "../../../utils/tokenMath";

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
    exchangeRate: string;
    priceImpact: string;
  };
}

export async function executePrepareSwapBundle(
  req: PrepareSwapRequest
): Promise<PrepareSwapResponse> {
  const chain = getChainConfig("base");
  const executorAddress = chain.contracts.panoramaExecutor;
  const amountIn = BigInt(req.amountIn);
  const stable = req.stable ?? false;
  const slippageBps = req.slippageBps ?? 50;
  const deadlineMinutes = req.deadlineMinutes ?? 20;

  // Get quote on-chain
  const { amountOut } = await getQuote(req.tokenIn, req.tokenOut, amountIn, stable);
  const amountOutMin = applySlippage(amountOut, slippageBps);

  const steps: PreparedTransaction[] = [];
  const erc20Iface = new ethers.Interface(ERC20_ABI);
  const executorIface = new ethers.Interface(PANORAMA_EXECUTOR_ABI);
  const protocolId = encodeProtocolId("aerodrome");
  const extraData = encodeSwapExtraData(stable);
  const deadline = getDeadline(deadlineMinutes);

  // Step 1 - Approve tokenIn to Executor (if not native ETH)
  let value = "0";
  if (isNativeETH(req.tokenIn)) {
    value = amountIn.toString();
  } else {
    const tokenContract = getContract(req.tokenIn, ERC20_ABI, "base");
    const allowance: bigint = await tokenContract.allowance(req.userAddress, executorAddress);
    if (allowance < amountIn) {
      steps.push({
        to: req.tokenIn,
        data: erc20Iface.encodeFunctionData("approve", [executorAddress, amountIn]),
        value: "0",
        chainId: chain.chainId,
        description: `Approve token for swap`,
      });
    }
  }

  // Step 2 - Execute swap via PanoramaExecutor
  steps.push({
    to: executorAddress,
    data: executorIface.encodeFunctionData("executeSwap", [
      protocolId,
      req.tokenIn,
      req.tokenOut,
      amountIn,
      amountOutMin,
      extraData,
      deadline,
    ]),
    value,
    chainId: chain.chainId,
    description: `Swap via Aerodrome`,
  });

  const exchangeRate = await formatExchangeRate(req.tokenIn, req.tokenOut, amountIn, amountOut, 8);

  return {
    bundle: {
      steps,
      totalSteps: steps.length,
      summary: `Swap via Aerodrome (${stable ? "stable" : "volatile"} pool)`,
    },
    metadata: {
      tokenIn: req.tokenIn,
      tokenOut: req.tokenOut,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      amountOutMin: amountOutMin.toString(),
      stable,
      slippageBps,
      priceImpact: "derived from route quote; exact impact computed at execution",
      exchangeRate,
    },
  };
}
