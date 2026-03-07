import { getChainConfig } from "../../../config/chains";
import { getContract } from "../../../providers/chain.provider";
import { DCA_VAULT_ABI } from "../../../utils/abi";

export interface DCAOrderInfo {
  orderId: number;
  owner: string;
  tokenIn: string;
  tokenOut: string;
  amountPerSwap: string;
  interval: number;
  lastExecuted: number;
  nextExecutionAt: number;
  remainingSwaps: number;
  balance: string;
  stable: boolean;
  active: boolean;
  executable: boolean;
}

export interface GetOrdersResponse {
  orders: DCAOrderInfo[];
}

export async function executeGetOrders(userAddress: string): Promise<GetOrdersResponse> {
  const chain = getChainConfig("base");
  const vault = getContract(chain.contracts.dcaVault, DCA_VAULT_ABI, "base");

  const orderIds: bigint[] = await vault.getUserOrders(userAddress);
  const orders: DCAOrderInfo[] = [];

  for (const id of orderIds) {
    try {
      const [order, executable, nextAt] = await Promise.all([
        vault.orders(id),
        vault.isExecutable(id),
        vault.nextExecutionAt(id),
      ]);

      orders.push({
        orderId: Number(id),
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
        executable,
      });
    } catch {
      // skip orders that fail to load
    }
  }

  return { orders };
}

export async function executeGetOrder(orderId: number): Promise<DCAOrderInfo> {
  const chain = getChainConfig("base");
  const vault = getContract(chain.contracts.dcaVault, DCA_VAULT_ABI, "base");

  const [order, executable, nextAt] = await Promise.all([
    vault.orders(BigInt(orderId)),
    vault.isExecutable(BigInt(orderId)),
    vault.nextExecutionAt(BigInt(orderId)),
  ]);

  if (order.owner === "0x0000000000000000000000000000000000000000") {
    throw new Error(`Order ${orderId} not found`);
  }

  return {
    orderId,
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
    executable,
  };
}
