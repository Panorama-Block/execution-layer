import { ethers } from "ethers";
import { getChainConfig } from "../config/chains";
import { PANORAMA_EXECUTOR_ABI } from "../utils/abi";
import { encodeProtocolId, encodeLiquidityExtraData, getDeadline, isNativeETH } from "../utils/encoding";

export interface PrepareLiquidityRequest {
  tokenA: string;
  tokenB: string;
  amountA: string;
  amountB: string;
  minLpAmount?: string;
  stable?: boolean;
  deadlineMinutes?: number;
}

export interface PreparedTransaction {
  to: string;
  data: string;
  value: string;
  chainId: number;
}

export async function executePrepareAddLiquidity(
  req: PrepareLiquidityRequest
): Promise<PreparedTransaction> {
  const chain = getChainConfig("base");
  const amountA = BigInt(req.amountA);
  const amountB = BigInt(req.amountB);
  const minLpAmount = BigInt(req.minLpAmount ?? "0");
  const stable = req.stable ?? false;
  const deadlineMinutes = req.deadlineMinutes ?? 20;

  const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI);
  const protocolId = encodeProtocolId("aerodrome");
  const extraData = encodeLiquidityExtraData(stable);
  const deadline = getDeadline(deadlineMinutes);

  const data = iface.encodeFunctionData("executeAddLiquidity", [
    protocolId,
    req.tokenA,
    req.tokenB,
    amountA,
    amountB,
    minLpAmount,
    extraData,
    deadline,
  ]);

  // If either token is native ETH, send its amount as value
  let value = "0";
  if (isNativeETH(req.tokenA)) value = amountA.toString();
  else if (isNativeETH(req.tokenB)) value = amountB.toString();

  return {
    to: chain.contracts.panoramaExecutor,
    data,
    value,
    chainId: chain.chainId,
  };
}
