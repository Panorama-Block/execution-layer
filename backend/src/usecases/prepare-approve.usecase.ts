import { ethers } from "ethers";
import { getChainConfig } from "../config/chains";
import { ERC20_ABI } from "../utils/abi";
import { PreparedTransaction } from "../types/transaction";

export interface PrepareApproveRequest {
  token: string;
  spender: string;
  amount: string;
}

export async function executePrepareApprove(
  req: PrepareApproveRequest
): Promise<PreparedTransaction> {
  const chain = getChainConfig("base");

  const iface = new ethers.Interface(ERC20_ABI);
  const data = iface.encodeFunctionData("approve", [req.spender, req.amount]);

  return {
    to: req.token,
    data,
    value: "0",
    chainId: chain.chainId,
  };
}
