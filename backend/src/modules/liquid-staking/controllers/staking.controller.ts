import { Request, Response } from "express";
import { executeEnterStrategy } from "../usecases/prepare-enter-strategy.usecase";
import { executeExitStrategy } from "../usecases/prepare-exit-strategy.usecase";
import { executeClaimRewards } from "../usecases/prepare-claim-rewards.usecase";
import { executeGetStakingPools } from "../usecases/get-staking-pools.usecase";
import { executeGetPosition } from "../usecases/get-position.usecase";
import { executeGetProtocolInfo } from "../usecases/get-protocol-info.usecase";
import { executeGetPortfolio } from "../usecases/get-portfolio.usecase";
import { submitTransaction, getTransaction, getUserTransactions } from "../../../shared/transactionStore";

export async function prepareEnterStrategy(req: Request, res: Response) {
  const { userAddress, poolId, amountA, amountB, slippageBps, deadlineMinutes } = req.body;
  const result = await executeEnterStrategy({
    userAddress, poolId, amountA, amountB, slippageBps, deadlineMinutes,
  });
  return res.json(result);
}

export async function prepareExitStrategy(req: Request, res: Response) {
  const { userAddress, poolId, amount, deadlineMinutes } = req.body;
  const result = await executeExitStrategy({
    userAddress, poolId, amount, deadlineMinutes,
  });
  return res.json(result);
}

export async function prepareClaimRewards(req: Request, res: Response) {
  const { userAddress, poolId } = req.body;
  const result = await executeClaimRewards({ userAddress, poolId });
  return res.json(result);
}

export async function getStakingPools(_req: Request, res: Response) {
  const result = await executeGetStakingPools();
  return res.json(result);
}

export async function getPosition(req: Request, res: Response) {
  const { userAddress } = req.params;
  const result = await executeGetPosition({ userAddress });
  return res.json(result);
}

export async function getProtocolInfo(_req: Request, res: Response) {
  const result = await executeGetProtocolInfo();
  return res.json(result);
}

export async function getPortfolio(req: Request, res: Response) {
  const { userAddress } = req.params;
  const result = await executeGetPortfolio(userAddress);
  return res.json(result);
}

export async function submitTx(req: Request, res: Response) {
  const { txHash, userAddress, action } = req.body;
  const tx = submitTransaction(txHash, userAddress, "staking", action ?? "unknown");
  return res.json(tx);
}

export async function getTxStatus(req: Request, res: Response) {
  const { txHash } = req.params;
  const tx = getTransaction(txHash);
  if (!tx) {
    return res.status(404).json({ error: { code: "TRANSACTION_NOT_FOUND", message: "Transaction not found" } });
  }
  return res.json(tx);
}

export async function getTxHistory(req: Request, res: Response) {
  const { userAddress } = req.params;
  const txs = getUserTransactions(userAddress);
  return res.json({ transactions: txs, total: txs.length });
}
