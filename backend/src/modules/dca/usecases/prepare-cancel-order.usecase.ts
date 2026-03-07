import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { getContract } from "../../../providers/chain.provider";
import { DCA_VAULT_ABI } from "../../../utils/abi";
import { PreparedTransaction, TransactionBundle } from "../../../types/transaction";

export interface PrepareCancelOrderRequest {
  userAddress: string;
  orderId: number;
  withdrawAfter?: boolean; // if true, include withdraw step
}

export interface PrepareCancelOrderResponse {
  bundle: TransactionBundle;
}

export async function executePrepareCancel(
  req: PrepareCancelOrderRequest
): Promise<PrepareCancelOrderResponse> {
  const chain = getChainConfig("base");
  const dcaVaultAddress = chain.contracts.dcaVault;
  const dcaIface = new ethers.Interface(DCA_VAULT_ABI);

  // Validate order exists and belongs to user
  const vault = getContract(dcaVaultAddress, DCA_VAULT_ABI, "base");
  const order = await vault.orders(req.orderId);
  if (order.owner.toLowerCase() !== req.userAddress.toLowerCase()) {
    throw new Error(`Order ${req.orderId} does not belong to ${req.userAddress}`);
  }
  if (!order.active) {
    throw new Error(`Order ${req.orderId} is already inactive`);
  }

  const steps: PreparedTransaction[] = [];

  // Step 1 — cancel
  steps.push({
    to: dcaVaultAddress,
    data: dcaIface.encodeFunctionData("cancel", [BigInt(req.orderId)]),
    value: "0",
    chainId: chain.chainId,
    description: `Cancel DCA order #${req.orderId}`,
  });

  // Step 2 — withdraw remaining balance (optional)
  if (req.withdrawAfter !== false && order.balance > 0n) {
    steps.push({
      to: dcaVaultAddress,
      data: dcaIface.encodeFunctionData("withdraw", [BigInt(req.orderId)]),
      value: "0",
      chainId: chain.chainId,
      description: `Withdraw remaining balance from order #${req.orderId}`,
    });
  }

  return {
    bundle: {
      steps,
      totalSteps: steps.length,
      summary: `Cancel DCA order #${req.orderId}`,
    },
  };
}
