import { Request, Response } from "express";
import { asyncHandler } from "../../../middleware/errorHandler";
import { executePrepareStake } from "../usecases/prepare-stake.usecase";
import { executePrepareRequestUnlock } from "../usecases/prepare-request-unlock.usecase";
import { executePrepareRedeem } from "../usecases/prepare-redeem.usecase";
import { getContract } from "../../../providers/chain.provider";
import { STAKED_AVAX_ABI } from "../../../utils/abi";

const S_AVAX_ADDRESS = "0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE";

export const prepareStake = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareStake({
    userAddress: req.body.userAddress,
    amount: req.body.amount,
  });
  res.json(result);
});

export const prepareRequestUnlock = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareRequestUnlock({
    userAddress: req.body.userAddress,
    sAvaxAmount: req.body.sAvaxAmount,
  });
  res.json(result);
});

export const prepareRedeem = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareRedeem({
    userAddress: req.body.userAddress,
    userUnlockIndex: Number(req.body.userUnlockIndex),
  });
  res.json(result);
});

export const getPosition = asyncHandler(async (req: Request, res: Response) => {
  const { userAddress } = req.params;

  const sAvaxContract = getContract(S_AVAX_ADDRESS, STAKED_AVAX_ABI, "avalanche");
  const balanceAbi = ["function balanceOf(address) external view returns (uint256)"];
  const sAvaxToken = getContract(S_AVAX_ADDRESS, balanceAbi, "avalanche");

  const [exchangeRate, sAvaxBalance] = await Promise.all([
    sAvaxContract.exchangeRateByRoundingDown() as Promise<bigint>,
    sAvaxToken.balanceOf(userAddress) as Promise<bigint>,
  ]);

  res.json({
    userAddress,
    sAvaxBalance: sAvaxBalance.toString(),
    exchangeRate: exchangeRate.toString(),
  });
});
