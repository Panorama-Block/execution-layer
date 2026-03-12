import { ethers } from "ethers";
import { getChainConfig } from "../config/chains";
import { PANORAMA_EXECUTOR_ABI } from "../utils/abi";
import { encodeProtocolId, encodeSwapExtraData, getDeadline, isNativeETH, applySlippage } from "../utils/encoding";
import { getQuote } from "../providers/aerodrome.provider";

export interface PrepareSwapRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps?: number;
  userAddress: string;
  stable?: boolean;
  deadlineMinutes?: number;
}

export interface PreparedTransaction {
  to: string;
  data: string;
  value: string;
  chainId: number;
}

export async function executePrepareSwap(req: PrepareSwapRequest): Promise<PreparedTransaction> {
  const chain = getChainConfig("base");
  const amountIn = BigInt(req.amountIn);
  const slippageBps = req.slippageBps ?? 50; // 0.5% default
  const stable = req.stable ?? false;
  const deadlineMinutes = req.deadlineMinutes ?? 20;

  // Get quote for amountOutMin calculation
  const { amountOut } = await getQuote(req.tokenIn, req.tokenOut, amountIn, stable);
  const amountOutMin = applySlippage(amountOut, slippageBps);

  // Encode calldata for PanoramaExecutor.executeSwap
  const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI);
  const protocolId = encodeProtocolId("aerodrome");
  const extraData = encodeSwapExtraData(stable);
  const deadline = getDeadline(deadlineMinutes);

  const data = iface.encodeFunctionData("executeSwap", [
    protocolId,
    req.tokenIn,
    req.tokenOut,
    amountIn,
    amountOutMin,
    extraData,
    deadline,
  ]);

  // If tokenIn is native ETH, send value
  const value = isNativeETH(req.tokenIn) ? amountIn.toString() : "0";

  return {
    to: chain.contracts.panoramaExecutor,
    data,
    value,
    chainId: chain.chainId,
  };
}
