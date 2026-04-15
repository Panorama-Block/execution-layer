import { Request, Response } from "express";
import { asyncHandler } from "../../../middleware/errorHandler";
import { executePrepareStake } from "../usecases/prepare-stake.usecase";
import { executePrepareRequestUnlock } from "../usecases/prepare-request-unlock.usecase";
import { executePrepareRedeem } from "../usecases/prepare-redeem.usecase";
import { getContract } from "../../../providers/chain.provider";
import { STAKED_AVAX_ABI } from "../../../utils/abi";
import { S_AVAX_ADDRESS, BENQI_APR_URL } from "../config/avax-liquid-staking.config";

// Simple in-memory cache: avoid hitting Benqi API on every position request
let aprCache: { value: number; expiresAt: number } | null = null;

async function fetchSAvaxApr(): Promise<number | null> {
  if (aprCache && Date.now() < aprCache.expiresAt) return aprCache.value;
  try {
    const res = await fetch(BENQI_APR_URL);
    const json = await res.json() as { apr: number };
    aprCache = { value: json.apr * 100, expiresAt: Date.now() + 60 * 60 * 1000 }; // cache 1h
    return aprCache.value;
  } catch {
    return aprCache?.value ?? null; // return stale if available
  }
}

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

  const [totalPooledAvax, totalShares, sAvaxBalance, apy] = await Promise.all([
    sAvaxContract.totalPooledAvax() as Promise<bigint>,
    sAvaxContract.totalShares() as Promise<bigint>,
    sAvaxToken.balanceOf(userAddress) as Promise<bigint>,
    fetchSAvaxApr(),
  ]);

  // exchangeRate = totalPooledAvax * 1e18 / totalShares  (same formula as the contract)
  const exchangeRate = totalShares > 0n
    ? (totalPooledAvax * BigInt(1e18)) / totalShares
    : BigInt(1e18);

  res.json({
    userAddress,
    sAvaxBalance: sAvaxBalance.toString(),
    exchangeRate: exchangeRate.toString(),
    apy,
    pendingUnlocks: [],
  });
});
