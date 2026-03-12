import { ethers } from "ethers";
import { getChainConfig } from "../config/chains";
import { PANORAMA_EXECUTOR_ABI } from "../utils/abi";
import { encodeProtocolId } from "../utils/encoding";

export interface PrepareStakeRequest {
  lpToken: string;
  amount: string;
}

export interface PreparedTransaction {
  to: string;
  data: string;
  value: string;
  chainId: number;
}

export async function executePrepareStake(
  req: PrepareStakeRequest
): Promise<PreparedTransaction> {
  const chain = getChainConfig("base");
  const amount = BigInt(req.amount);

  const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI);
  const protocolId = encodeProtocolId("aerodrome");
  const extraData = "0x";

  const data = iface.encodeFunctionData("executeStake", [
    protocolId,
    req.lpToken,
    amount,
    extraData,
  ]);

  return {
    to: chain.contracts.panoramaExecutor,
    data,
    value: "0",
    chainId: chain.chainId,
  };
}

export async function executePrepareUnstake(
  req: PrepareStakeRequest
): Promise<PreparedTransaction> {
  const chain = getChainConfig("base");
  const amount = BigInt(req.amount);

  const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI);
  const protocolId = encodeProtocolId("aerodrome");
  const extraData = "0x";

  const data = iface.encodeFunctionData("executeUnstake", [
    protocolId,
    req.lpToken,
    amount,
    extraData,
  ]);

  return {
    to: chain.contracts.panoramaExecutor,
    data,
    value: "0",
    chainId: chain.chainId,
  };
}
