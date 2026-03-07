import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { getContract } from "../../../providers/chain.provider";
import { DCA_VAULT_ABI, ERC20_ABI } from "../../../utils/abi";
import { PreparedTransaction, TransactionBundle } from "../../../types/transaction";

export interface PrepareCreateOrderRequest {
  userAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountPerSwap: string;      // wei
  intervalSeconds: number;    // seconds between swaps
  remainingSwaps: number;     // 0 = unlimited
  stable: boolean;
  depositAmount: string;      // total tokenIn to deposit (must be >= amountPerSwap)
}

export interface PrepareCreateOrderResponse {
  bundle: TransactionBundle;
  metadata: {
    tokenIn: string;
    tokenOut: string;
    amountPerSwap: string;
    intervalSeconds: number;
    remainingSwaps: number;
    depositAmount: string;
    stable: boolean;
    estimatedExecutions: number;
    dcaVaultAddress: string;
  };
}

export async function executePrepareCreateOrder(
  req: PrepareCreateOrderRequest
): Promise<PrepareCreateOrderResponse> {
  const chain = getChainConfig("base");
  const dcaVaultAddress = chain.contracts.dcaVault;
  const amountPerSwap = BigInt(req.amountPerSwap);
  const depositAmount = BigInt(req.depositAmount);

  const steps: PreparedTransaction[] = [];
  const erc20Iface = new ethers.Interface(ERC20_ABI);
  const dcaIface = new ethers.Interface(DCA_VAULT_ABI);

  // Step 1 — Approve tokenIn to DCAVault
  const tokenContract = getContract(req.tokenIn, ERC20_ABI, "base");
  const allowance: bigint = await tokenContract.allowance(req.userAddress, dcaVaultAddress);
  if (allowance < depositAmount) {
    steps.push({
      to: req.tokenIn,
      data: erc20Iface.encodeFunctionData("approve", [dcaVaultAddress, depositAmount]),
      value: "0",
      chainId: chain.chainId,
      description: "Approve tokenIn to DCA Vault",
    });
  }

  // Step 2 — createOrder
  steps.push({
    to: dcaVaultAddress,
    data: dcaIface.encodeFunctionData("createOrder", [
      req.tokenIn,
      req.tokenOut,
      amountPerSwap,
      BigInt(req.intervalSeconds),
      BigInt(req.remainingSwaps),
      req.stable,
      depositAmount,
    ]),
    value: "0",
    chainId: chain.chainId,
    description: "Create DCA order",
  });

  const estimatedExecutions =
    req.remainingSwaps > 0
      ? Math.min(req.remainingSwaps, Number(depositAmount / amountPerSwap))
      : Number(depositAmount / amountPerSwap);

  return {
    bundle: {
      steps,
      totalSteps: steps.length,
      summary: `Create DCA order — swap every ${req.intervalSeconds}s`,
    },
    metadata: {
      tokenIn: req.tokenIn,
      tokenOut: req.tokenOut,
      amountPerSwap: amountPerSwap.toString(),
      intervalSeconds: req.intervalSeconds,
      remainingSwaps: req.remainingSwaps,
      depositAmount: depositAmount.toString(),
      stable: req.stable,
      estimatedExecutions,
      dcaVaultAddress,
    },
  };
}
