import { getContract } from "../providers/chain.provider";
import { ERC20_ABI } from "../utils/abi";

export interface CheckAllowanceRequest {
  token: string;
  owner: string;
  spender: string;
}

export interface CheckAllowanceResponse {
  token: string;
  owner: string;
  spender: string;
  allowance: string;
  isApproved: boolean;
}

export async function executeCheckAllowance(
  req: CheckAllowanceRequest
): Promise<CheckAllowanceResponse> {
  const tokenContract = getContract(req.token, ERC20_ABI, "base");
  const allowance: bigint = await tokenContract.allowance(req.owner, req.spender);

  return {
    token: req.token,
    owner: req.owner,
    spender: req.spender,
    allowance: allowance.toString(),
    isApproved: allowance > 0n,
  };
}
