import { getChainConfig } from "../../../config/chains";
import { getContract } from "../../../providers/chain.provider";
import { DCA_VAULT_ABI } from "../../../utils/abi";
import { DCAOrderInfo } from "./get-orders.usecase";

export interface GetExecutableOrdersResponse {
  orders: DCAOrderInfo[];
  checkedUpTo: number;
  timestamp: number;
}

/**
 * Scans orders [0, upTo) and returns those ready to execute.
 * This is the endpoint your keeper should poll.
 */
export async function executeGetExecutableOrders(
  upTo: number
): Promise<GetExecutableOrdersResponse> {
  const chain = getChainConfig("base");
  const vault = getContract(chain.contracts.dcaVault, DCA_VAULT_ABI, "base");

  const executable: DCAOrderInfo[] = [];

  for (let i = 0; i < upTo; i++) {
    try {
      const order = await vault.orders(BigInt(i));
      if (!order.active) continue;

      const [isExec, nextAt] = await Promise.all([
        vault.isExecutable(BigInt(i)),
        vault.nextExecutionAt(BigInt(i)),
      ]);

      if (isExec) {
        executable.push({
          orderId: i,
          owner: order.owner,
          tokenIn: order.tokenIn,
          tokenOut: order.tokenOut,
          amountPerSwap: order.amountPerSwap.toString(),
          interval: Number(order.interval),
          lastExecuted: Number(order.lastExecuted),
          nextExecutionAt: Number(nextAt),
          remainingSwaps: Number(order.remainingSwaps),
          balance: order.balance.toString(),
          stable: order.stable,
          active: order.active,
          executable: true,
        });
      }
    } catch {
      // order not found, skip
    }
  }

  return {
    orders: executable,
    checkedUpTo: upTo,
    timestamp: Math.floor(Date.now() / 1000),
  };
}
