import { Request, Response } from "express";
import { executeGetQuote } from "../usecases/get-quote.usecase";
import { executePrepareSwap } from "../usecases/prepare-swap.usecase";
import { executePrepareAddLiquidity } from "../usecases/prepare-liquidity.usecase";
import { executePrepareStake, executePrepareUnstake } from "../usecases/prepare-stake.usecase";
import { executeGetPools, executeGetPoolDetail } from "../usecases/get-pools.usecase";
import { executeCheckAllowance } from "../usecases/check-allowance.usecase";
import { executePrepareApprove } from "../usecases/prepare-approve.usecase";

export async function getQuote(req: Request, res: Response) {
  try {
    const { tokenIn, tokenOut, amountIn, stable } = req.body;
    if (!tokenIn || !tokenOut || !amountIn) {
      return res.status(400).json({ error: "Missing required fields: tokenIn, tokenOut, amountIn" });
    }
    const result = await executeGetQuote({ tokenIn, tokenOut, amountIn, stable });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function prepareSwap(req: Request, res: Response) {
  try {
    const { tokenIn, tokenOut, amountIn, slippageBps, userAddress, stable, deadlineMinutes } = req.body;
    if (!tokenIn || !tokenOut || !amountIn || !userAddress) {
      return res.status(400).json({ error: "Missing required fields: tokenIn, tokenOut, amountIn, userAddress" });
    }
    const tx = await executePrepareSwap({ tokenIn, tokenOut, amountIn, slippageBps, userAddress, stable, deadlineMinutes });
    return res.json(tx);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function prepareLiquidity(req: Request, res: Response) {
  try {
    const { tokenA, tokenB, amountA, amountB, slippageBps, stable, deadlineMinutes } = req.body;
    if (!tokenA || !tokenB || !amountA || !amountB) {
      return res.status(400).json({ error: "Missing required fields: tokenA, tokenB, amountA, amountB" });
    }
    const tx = await executePrepareAddLiquidity({ tokenA, tokenB, amountA, amountB, slippageBps, stable, deadlineMinutes });
    return res.json(tx);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function prepareStake(req: Request, res: Response) {
  try {
    const { lpToken, amount } = req.body;
    if (!lpToken || !amount) {
      return res.status(400).json({ error: "Missing required fields: lpToken, amount" });
    }
    const tx = await executePrepareStake({ lpToken, amount });
    return res.json(tx);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function prepareUnstake(req: Request, res: Response) {
  try {
    const { lpToken, amount } = req.body;
    if (!lpToken || !amount) {
      return res.status(400).json({ error: "Missing required fields: lpToken, amount" });
    }
    const tx = await executePrepareUnstake({ lpToken, amount });
    return res.json(tx);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getPools(_req: Request, res: Response) {
  try {
    const result = await executeGetPools();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function checkAllowance(req: Request, res: Response) {
  try {
    const { token, owner, spender } = req.body;
    if (!token || !owner || !spender) {
      return res.status(400).json({ error: "Missing required fields: token, owner, spender" });
    }
    const result = await executeCheckAllowance({ token, owner, spender });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function prepareApprove(req: Request, res: Response) {
  try {
    const { token, spender, amount } = req.body;
    if (!token || !spender || !amount) {
      return res.status(400).json({ error: "Missing required fields: token, spender, amount" });
    }
    const tx = await executePrepareApprove({ token, spender, amount });
    return res.json(tx);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getPoolDetail(req: Request, res: Response) {
  try {
    const { tokenA, tokenB, stable } = req.body;
    if (!tokenA || !tokenB) {
      return res.status(400).json({ error: "Missing required fields: tokenA, tokenB" });
    }
    const result = await executeGetPoolDetail({ tokenA, tokenB, stable });
    if (!result) {
      return res.status(404).json({ error: "Pool not found" });
    }
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
