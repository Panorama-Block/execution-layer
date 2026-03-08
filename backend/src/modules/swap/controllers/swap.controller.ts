import { Request, Response } from "express";
import { executePrepareSwapBundle } from "../usecases/prepare-swap.usecase";
import { executeGetSwapQuote } from "../usecases/get-quote.usecase";
import { executeGetSwapPairs } from "../usecases/get-swap-pairs.usecase";
import { submitTransaction, getTransaction, getUserTransactions } from "../../../shared/transactionStore";

export async function prepareSwap(req: Request, res: Response) {
  const { userAddress, tokenIn, tokenOut, amountIn, stable, slippageBps, deadlineMinutes } = req.body;
  const result = await executePrepareSwapBundle({
    userAddress, tokenIn, tokenOut, amountIn, stable, slippageBps, deadlineMinutes,
  });
  return res.json(result);
}

export async function getQuote(req: Request, res: Response) {
  const { tokenIn, tokenOut, amountIn, stable, slippageBps } = req.body;
  const result = await executeGetSwapQuote({ tokenIn, tokenOut, amountIn, stable, slippageBps });
  return res.json(result);
}

export async function getSwapPairs(_req: Request, res: Response) {
  const result = await executeGetSwapPairs();
  return res.json(result);
}

export async function submitSwapTx(req: Request, res: Response) {
  const { txHash, userAddress, action } = req.body;
  const tx = submitTransaction(txHash, userAddress, "swap", action ?? "swap");
  return res.json(tx);
}

export async function getSwapTxStatus(req: Request, res: Response) {
  const { txHash } = req.params;
  const tx = getTransaction(txHash);
  if (!tx) {
    return res.status(404).json({ error: { code: "TRANSACTION_NOT_FOUND", message: "Transaction not found" } });
  }
  return res.json(tx);
}

export async function getSwapHistory(req: Request, res: Response) {
  const { userAddress } = req.params;
  const txs = getUserTransactions(userAddress).filter(t => t.module === "swap");
  return res.json({ transactions: txs, total: txs.length });
}
