import { Request, Response } from "express";
import { executePrepareCreateOrder } from "../usecases/prepare-create-order.usecase";
import { executePrepareCancel } from "../usecases/prepare-cancel-order.usecase";
import { executeGetOrders, executeGetOrder } from "../usecases/get-orders.usecase";
import { executeGetExecutableOrders } from "../usecases/get-executable-orders.usecase";
import { submitTransaction, getTransaction, getUserTransactions } from "../../../shared/transactionStore";

export async function prepareCreateOrder(req: Request, res: Response) {
  const {
    userAddress, tokenIn, tokenOut, amountPerSwap,
    intervalSeconds, remainingSwaps, stable, depositAmount,
  } = req.body;
  const result = await executePrepareCreateOrder({
    userAddress, tokenIn, tokenOut, amountPerSwap,
    intervalSeconds, remainingSwaps: remainingSwaps ?? 0,
    stable: stable ?? false, depositAmount,
  });
  return res.json(result);
}

export async function prepareCancelOrder(req: Request, res: Response) {
  const { userAddress, orderId, withdrawAfter } = req.body;
  const result = await executePrepareCancel({ userAddress, orderId, withdrawAfter });
  return res.json(result);
}

export async function getOrders(req: Request, res: Response) {
  const { userAddress } = req.params;
  const result = await executeGetOrders(userAddress);
  return res.json(result);
}

export async function getOrder(req: Request, res: Response) {
  const orderId = parseInt(req.params.orderId);
  const result = await executeGetOrder(orderId);
  return res.json(result);
}

export async function getExecutableOrders(req: Request, res: Response) {
  const upTo = parseInt(req.query.upTo as string) || 100;
  const result = await executeGetExecutableOrders(upTo);
  return res.json(result);
}

export async function submitDcaTx(req: Request, res: Response) {
  const { txHash, userAddress, action } = req.body;
  const tx = submitTransaction(txHash, userAddress, "dca", action ?? "dca");
  return res.json(tx);
}

export async function getDcaTxStatus(req: Request, res: Response) {
  const { txHash } = req.params;
  const tx = getTransaction(txHash);
  if (!tx) {
    return res.status(404).json({ error: { code: "TRANSACTION_NOT_FOUND", message: "Transaction not found" } });
  }
  return res.json(tx);
}

export async function getDcaHistory(req: Request, res: Response) {
  const { userAddress } = req.params;
  const txs = getUserTransactions(userAddress).filter(t => t.module === "dca");
  return res.json({ transactions: txs, total: txs.length });
}
