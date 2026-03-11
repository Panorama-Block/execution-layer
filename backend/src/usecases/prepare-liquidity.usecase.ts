import { ethers } from "ethers";
import { getChainConfig } from "../config/chains";
import { PANORAMA_EXECUTOR_ABI } from "../utils/abi";
import { encodeProtocolId, getDeadline, isNativeETH, applySlippage } from "../utils/encoding";
import { PreparedTransaction } from "../types/transaction";
import { AppError } from "../shared/errorCodes";

export interface PrepareLiquidityRequest {
  tokenA: string;
  tokenB: string;
  amountA: string;
  amountB: string;
  slippageBps?: number;
  stable?: boolean;
  deadlineMinutes?: number;
}

export async function executePrepareAddLiquidity(
  req: PrepareLiquidityRequest
): Promise<PreparedTransaction> {
  const chain = getChainConfig("base");
  const amountA = BigInt(req.amountA);
  const amountB = BigInt(req.amountB);
  const stable = req.stable ?? false;
  const slippageBps = req.slippageBps ?? 50;
  const deadlineMinutes = req.deadlineMinutes ?? 20;

  if (isNativeETH(req.tokenA) || isNativeETH(req.tokenB)) {
    throw new AppError(
      "UNSUPPORTED_OPERATION",
      "Native ETH liquidity is not supported by PanoramaExecutor; use ERC-20 token addresses only"
    );
  }

  const amountAMin = applySlippage(amountA, slippageBps);
  const amountBMin = applySlippage(amountB, slippageBps);

  const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI);
  const protocolId = encodeProtocolId("aerodrome");
  const extraData = "0x";
  const deadline = getDeadline(deadlineMinutes);

  const data = iface.encodeFunctionData("executeAddLiquidity", [
    protocolId,
    req.tokenA,
    req.tokenB,
    stable,
    amountA,
    amountB,
    amountAMin,
    amountBMin,
    extraData,
    deadline,
  ]);

  return {
    to: chain.contracts.panoramaExecutor,
    data,
    value: "0",
    chainId: chain.chainId,
  };
}
