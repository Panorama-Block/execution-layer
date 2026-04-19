import { Request, Response } from "express";
import { asyncHandler }                from "../../../middleware/errorHandler";
import { executePrepareDeposit }       from "../usecases/prepare-deposit.usecase";
import { executePrepareWithdraw }      from "../usecases/prepare-withdraw.usecase";
import { executePrepareMint }          from "../usecases/prepare-mint.usecase";
import { executePrepareRepay }         from "../usecases/prepare-repay.usecase";
import { executePrepareUnwind }        from "../usecases/prepare-unwind.usecase";
import { executeGetUserPosition }      from "../usecases/get-user-position.usecase";
import {
  METRONOME_COLLATERAL_MARKETS,
  METRONOME_SYNTHETIC_MARKETS,
}                                      from "../config/metronome-markets";

export const getMarkets = asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    collateral: METRONOME_COLLATERAL_MARKETS,
    synthetic:  METRONOME_SYNTHETIC_MARKETS,
  });
});

export const getUserPosition = asyncHandler(async (req: Request, res: Response) => {
  const result = await executeGetUserPosition(req.params.userAddress);
  res.json(result);
});

export const prepareDeposit = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareDeposit({
    userAddress:         req.body.userAddress,
    depositTokenAddress: req.body.depositTokenAddress,
    amount:              req.body.amount,
  });
  res.json(result);
});

export const prepareWithdraw = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareWithdraw({
    userAddress:         req.body.userAddress,
    depositTokenAddress: req.body.depositTokenAddress,
    amount:              req.body.amount,
    recipient:           req.body.recipient,
  });
  res.json(result);
});

export const prepareMint = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareMint({
    userAddress:      req.body.userAddress,
    debtTokenAddress: req.body.debtTokenAddress,
    amount:           req.body.amount,
    recipient:        req.body.recipient,
  });
  res.json(result);
});

export const prepareRepay = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareRepay({
    userAddress:      req.body.userAddress,
    debtTokenAddress: req.body.debtTokenAddress,
    amount:           req.body.amount,
  });
  res.json(result);
});

export const prepareUnwind = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareUnwind({
    userAddress:         req.body.userAddress,
    debtTokenAddress:    req.body.debtTokenAddress,
    depositTokenAddress: req.body.depositTokenAddress,
    synthAmount:         req.body.synthAmount,
    recipient:           req.body.recipient,
  });
  res.json(result);
});
