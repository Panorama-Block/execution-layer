import { Request, Response } from "express";
import { asyncHandler } from "../../../middleware/errorHandler";
import { executePrepareStake } from "../usecases/prepare-stake.usecase";
import { executePrepareRequestUnlock } from "../usecases/prepare-request-unlock.usecase";
import { executePrepareRedeem } from "../usecases/prepare-redeem.usecase";
import { getChainConfig } from "../../../config/chains";
import { getContract } from "../../../providers/chain.provider";
import { PANORAMA_LIQUID_STAKING_ABI } from "../../../utils/abi";
import { AppError } from "../../../shared/errorCodes";

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
  const chain = getChainConfig("avalanche");
  const contractAddr = chain.contracts.panoramaLiquidStaking;
  if (!contractAddr) throw new AppError("INTERNAL_ERROR", "PanoramaLiquidStaking not deployed yet");

  const contract = getContract(contractAddr, PANORAMA_LIQUID_STAKING_ABI, "avalanche");

  const [unlockCount, exchangeRate] = await Promise.all([
    contract.getUnlockRequestCount(userAddress) as Promise<bigint>,
    contract.exchangeRate() as Promise<bigint>,
  ]);

  const count = Number(unlockCount);
  const unlockRequests = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      (contract.getUnlockRequest(userAddress, i) as Promise<{ shareAmount: bigint; unlockTime: bigint }>).then(r => ({
        userUnlockIndex: i,
        shareAmount: r.shareAmount.toString(),
        unlockTime: Number(r.unlockTime),
        unlockTimeISO: new Date(Number(r.unlockTime) * 1000).toISOString(),
        redeemable: Date.now() / 1000 >= Number(r.unlockTime),
      }))
    )
  );

  res.json({
    userAddress,
    exchangeRate: exchangeRate.toString(),
    pendingUnlocks: unlockRequests,
  });
});
