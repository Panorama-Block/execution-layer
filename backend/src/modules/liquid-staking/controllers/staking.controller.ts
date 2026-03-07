import { Request, Response } from "express";
import { executeEnterStrategy } from "../usecases/prepare-enter-strategy.usecase";
import { executeExitStrategy } from "../usecases/prepare-exit-strategy.usecase";
import { executeClaimRewards } from "../usecases/prepare-claim-rewards.usecase";
import { executeGetStakingPools } from "../usecases/get-staking-pools.usecase";
import { executeGetPosition } from "../usecases/get-position.usecase";

export async function prepareEnterStrategy(req: Request, res: Response) {
  try {
    const { userAddress, poolId, amountA, amountB, slippageBps, deadlineMinutes } = req.body;
    if (!userAddress || !poolId || !amountA || !amountB) {
      return res.status(400).json({
        error: "Missing required fields: userAddress, poolId, amountA, amountB",
      });
    }
    const result = await executeEnterStrategy({
      userAddress,
      poolId,
      amountA,
      amountB,
      slippageBps,
      deadlineMinutes,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function prepareExitStrategy(req: Request, res: Response) {
  try {
    const { userAddress, poolId, amount, deadlineMinutes } = req.body;
    if (!userAddress || !poolId) {
      return res.status(400).json({
        error: "Missing required fields: userAddress, poolId",
      });
    }
    const result = await executeExitStrategy({
      userAddress,
      poolId,
      amount,
      deadlineMinutes,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function prepareClaimRewards(req: Request, res: Response) {
  try {
    const { userAddress, poolId } = req.body;
    if (!userAddress || !poolId) {
      return res.status(400).json({
        error: "Missing required fields: userAddress, poolId",
      });
    }
    const result = await executeClaimRewards({ userAddress, poolId });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getStakingPools(_req: Request, res: Response) {
  try {
    const result = await executeGetStakingPools();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getPosition(req: Request, res: Response) {
  try {
    const { userAddress } = req.params;
    if (!userAddress) {
      return res.status(400).json({ error: "Missing required parameter: userAddress" });
    }
    const result = await executeGetPosition({ userAddress });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
