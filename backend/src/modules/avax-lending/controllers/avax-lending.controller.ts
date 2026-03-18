import { Request, Response } from "express";
import { asyncHandler }             from "../../../middleware/errorHandler";
import { executePrepareSupply }     from "../usecases/prepare-supply.usecase";
import { executePrepareRedeem }     from "../usecases/prepare-redeem.usecase";
import { executePrepareBorrow }     from "../usecases/prepare-borrow.usecase";
import { executePrepareRepay }      from "../usecases/prepare-repay.usecase";
import { getEnabledMarkets }        from "../config/avax-lending-markets";
import { avaxService }              from "../../../shared/services/avax.service";
import { getContract }              from "../../../providers/chain.provider";
import { BENQI_TOKEN_ABI }         from "../../../utils/abi";

export const getMarkets = asyncHandler(async (_req: Request, res: Response) => {
  const markets = getEnabledMarkets();

  const marketsWithRates = await Promise.all(
    markets.map(async (m) => {
      const [supplyRate, borrowRate] = await Promise.all([
        avaxService.getSupplyRate(m.qTokenAddress),
        avaxService.getBorrowRate(m.qTokenAddress),
      ]);
      return { ...m, supplyRatePerTimestamp: supplyRate.toString(), borrowRatePerTimestamp: borrowRate.toString() };
    })
  );

  res.json({ markets: marketsWithRates });
});

export const getUserPosition = asyncHandler(async (req: Request, res: Response) => {
  const { userAddress } = req.params;
  const markets = getEnabledMarkets();

  const positions = await Promise.all(
    markets.map(async (m) => {
      const qToken = getContract(m.qTokenAddress, BENQI_TOKEN_ABI, "avalanche");
      const [qTokenBalance, exchangeRate, borrowBalance] = await Promise.all([
        qToken.balanceOf(userAddress) as Promise<bigint>,
        qToken.exchangeRateStored() as Promise<bigint>,
        qToken.borrowBalanceStored(userAddress) as Promise<bigint>,
      ]);
      // suppliedWei = qTokenBalance × exchangeRate / 1e18  (Compound-fork formula)
      const suppliedWei = (qTokenBalance * exchangeRate) / BigInt(1e18);
      return {
        ...m,
        qTokenBalance: qTokenBalance.toString(),
        suppliedWei: suppliedWei.toString(),
        borrowedWei: borrowBalance.toString(),
      };
    })
  );

  const active = positions.filter(p => BigInt(p.qTokenBalance) > 0n || BigInt(p.borrowedWei) > 0n);
  res.json({ userAddress, positions: active });
});

export const prepareSupply = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareSupply({
    userAddress:   req.body.userAddress,
    qTokenAddress: req.body.qTokenAddress,
    amount:        req.body.amount,
  });
  res.json(result);
});

export const prepareRedeem = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareRedeem({
    userAddress:   req.body.userAddress,
    qTokenAddress: req.body.qTokenAddress,
    amount:        req.body.amount,
  });
  res.json(result);
});

export const prepareBorrow = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareBorrow({
    userAddress:   req.body.userAddress,
    qTokenAddress: req.body.qTokenAddress,
    amount:        req.body.amount,
  });
  res.json(result);
});

export const prepareRepay = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareRepay({
    userAddress:   req.body.userAddress,
    qTokenAddress: req.body.qTokenAddress,
    amount:        req.body.amount,
  });
  res.json(result);
});
