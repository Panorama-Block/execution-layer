import { Request, Response } from "express";
import { asyncHandler } from "../../../middleware/errorHandler";
import { executePrepareAddLiquidity }    from "../usecases/prepare-add-liquidity.usecase";
import { executePrepareRemoveLiquidity } from "../usecases/prepare-remove-liquidity.usecase";
import { executePrepareStake }           from "../usecases/prepare-stake.usecase";
import { executePrepareUnstake }         from "../usecases/prepare-unstake.usecase";
import { executePrepareClaimRewards }    from "../usecases/prepare-claim-rewards.usecase";
import { getEnabledPools, getPoolById }  from "../config/avax-lp-pools";
import { avaxLpService }                 from "../../../shared/services/avax-lp.service";

export const getPools = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ pools: getEnabledPools() });
});

export const getUserPosition = asyncHandler(async (req: Request, res: Response) => {
  const { userAddress } = req.params;
  const { proxyAddress } = req.query as { proxyAddress?: string };

  const pools   = getEnabledPools();
  const results = await Promise.all(
    pools.map(async (pool) => {
      const lpBalance = await avaxLpService.getLpBalance(pool.pairAddress, userAddress);
      const farmInfo  = proxyAddress && pool.farmPid !== null
        ? await avaxLpService.getUserFarmInfo(pool.farmPid, proxyAddress)
        : null;
      const pendingJoe = proxyAddress && pool.farmPid !== null
        ? await avaxLpService.getPendingRewards(pool.farmPid, proxyAddress)
        : 0n;

      return {
        poolId:       pool.id,
        pairAddress:  pool.pairAddress,
        symbolA:      pool.tokenA.symbol,
        symbolB:      pool.tokenB.symbol,
        farmPid:      pool.farmPid,
        lpBalance:    lpBalance.toString(),
        stakedAmount: farmInfo?.amount.toString() ?? "0",
        pendingJoe:   pendingJoe.toString(),
      };
    })
  );

  const active = results.filter(r => BigInt(r.lpBalance) > 0n || BigInt(r.stakedAmount) > 0n);
  res.json({ userAddress, positions: active });
});

export const prepareAddLiquidity = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareAddLiquidity({
    userAddress:    req.body.userAddress,
    tokenA:         req.body.tokenA,
    tokenB:         req.body.tokenB,
    amountADesired: req.body.amountADesired,
    amountBDesired: req.body.amountBDesired,
    slippageBps:    req.body.slippageBps,
  });
  res.json(result);
});

export const prepareRemoveLiquidity = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareRemoveLiquidity({
    userAddress: req.body.userAddress,
    tokenA:      req.body.tokenA,
    tokenB:      req.body.tokenB,
    lpAmount:    req.body.lpAmount,
    amountAMin:  req.body.amountAMin,
    amountBMin:  req.body.amountBMin,
  });
  res.json(result);
});

export const prepareStake = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareStake({
    userAddress: req.body.userAddress,
    poolId:      req.body.poolId,
    lpAmount:    req.body.lpAmount,
  });
  res.json(result);
});

export const prepareUnstake = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareUnstake({
    userAddress:  req.body.userAddress,
    poolId:       req.body.poolId,
    lpAmount:     req.body.lpAmount,
    proxyAddress: req.body.proxyAddress,
  });
  res.json(result);
});

export const prepareClaimRewards = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareClaimRewards({
    userAddress:  req.body.userAddress,
    poolId:       req.body.poolId,
    proxyAddress: req.body.proxyAddress,
  });
  res.json(result);
});
