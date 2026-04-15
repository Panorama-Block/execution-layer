import { Request, Response } from "express";
import { asyncHandler }           from "../../../middleware/errorHandler";
import { executePrepareSupply }   from "../usecases/prepare-supply.usecase";
import { executePrepareRedeem }   from "../usecases/prepare-redeem.usecase";
import { executePrepareBorrow }   from "../usecases/prepare-borrow.usecase";
import { executePrepareRepay }    from "../usecases/prepare-repay.usecase";
import { getEnabledMarkets }      from "../config/moonwell-markets";
import { getContract }            from "../../../providers/chain.provider";
import { MOONWELL_TOKEN_ABI }     from "../../../utils/abi";

export const getMarkets = asyncHandler(async (_req: Request, res: Response) => {
  const markets = getEnabledMarkets();

  const marketsWithRates = await Promise.all(
    markets.map(async (m) => {
      const mToken = getContract(m.mTokenAddress, MOONWELL_TOKEN_ABI, "base");
      const [supplyRate, borrowRate] = await Promise.all([
        mToken.supplyRatePerBlock() as Promise<bigint>,
        mToken.borrowRatePerBlock() as Promise<bigint>,
      ]);
      return {
        ...m,
        supplyRatePerBlock: supplyRate.toString(),
        borrowRatePerBlock: borrowRate.toString(),
      };
    })
  );

  res.json({ markets: marketsWithRates });
});

export const getUserPosition = asyncHandler(async (req: Request, res: Response) => {
  const { userAddress } = req.params;
  const markets = getEnabledMarkets();

  const positions = await Promise.all(
    markets.map(async (m) => {
      const mToken = getContract(m.mTokenAddress, MOONWELL_TOKEN_ABI, "base");
      const [mTokenBalance, exchangeRate, borrowBalance] = await Promise.all([
        mToken.balanceOf(userAddress) as Promise<bigint>,
        mToken.exchangeRateStored() as Promise<bigint>,
        mToken.borrowBalanceStored(userAddress) as Promise<bigint>,
      ]);
      // suppliedWei = mTokenBalance × exchangeRate / 1e18  (Compound v2 formula)
      const suppliedWei = (mTokenBalance * exchangeRate) / BigInt(1e18);
      return {
        ...m,
        mTokenBalance: mTokenBalance.toString(),
        suppliedWei:   suppliedWei.toString(),
        borrowedWei:   borrowBalance.toString(),
      };
    })
  );

  const active = positions.filter(p => BigInt(p.mTokenBalance) > 0n || BigInt(p.borrowedWei) > 0n);
  res.json({ userAddress, positions: active });
});

export const prepareSupply = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareSupply({
    userAddress:   req.body.userAddress,
    mTokenAddress: req.body.mTokenAddress,
    amount:        req.body.amount,
    useNativeETH:  req.body.useNativeETH,
  });
  res.json(result);
});

export const prepareRedeem = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareRedeem({
    userAddress:   req.body.userAddress,
    mTokenAddress: req.body.mTokenAddress,
    amount:        req.body.amount,
    useNativeETH:  req.body.useNativeETH,
  });
  res.json(result);
});

export const prepareBorrow = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareBorrow({
    userAddress:   req.body.userAddress,
    mTokenAddress: req.body.mTokenAddress,
    amount:        req.body.amount,
    useNativeETH:  req.body.useNativeETH,
  });
  res.json(result);
});

export const prepareRepay = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareRepay({
    userAddress:   req.body.userAddress,
    mTokenAddress: req.body.mTokenAddress,
    amount:        req.body.amount,
    useNativeETH:  req.body.useNativeETH,
  });
  res.json(result);
});
