import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, METRONOME_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { getCollateralMarketByDepositToken } from "../config/metronome-markets";

export interface PrepareWithdrawRequest {
  userAddress:         string;
  depositTokenAddress: string; // Metronome DepositToken (e.g. USDCDepositToken)
  amount:              string; // share units of the deposit-token
  recipient?:          string; // defaults to userAddress
}

export interface PrepareWithdrawResponse {
  bundle:   TransactionBundle;
  metadata: {
    action:             "withdraw_collateral";
    depositToken:       string;
    depositTokenSymbol: string;
    underlyingSymbol:   string;
    amount:             string;
    recipient:          string;
  };
}

export async function executePrepareWithdraw(
  req: PrepareWithdrawRequest
): Promise<PrepareWithdrawResponse> {
  const chain        = getChainConfig("base");
  const executorAddr = chain.contracts.panoramaExecutor;
  if (!executorAddr) throw new AppError("INTERNAL_ERROR", "PanoramaExecutor not deployed on Base");

  const market = getCollateralMarketByDepositToken(req.depositTokenAddress);
  if (!market) {
    throw new AppError(
      "POOL_NOT_FOUND",
      `Metronome collateral market not found for depositToken: ${req.depositTokenAddress}`
    );
  }

  const amount = BigInt(req.amount);
  if (amount <= 0n) throw new AppError("INVALID_AMOUNT", "amount must be positive");

  const recipient  = req.recipient ?? req.userAddress;
  const protocolId = encodeProtocolId("metronome");
  const builder    = new BundleBuilder(chain.chainId);
  const deadline   = getDeadline(20);

  // Collateral shares already live on the per-user proxy — no approve / no transfers[].
  // withdrawCollateral(address depositToken, uint256 amount, address recipient)
  const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256", "address"],
    [req.depositTokenAddress, amount, recipient]
  );

  builder.addExecute(
    protocolId,
    METRONOME_SELECTORS.WITHDRAW_COLLATERAL,
    [],
    deadline,
    adapterData,
    0n,
    executorAddr,
    `Withdraw ${market.underlyingSymbol} collateral from Metronome`
  );

  return {
    bundle: await builder.buildWithGas(
      `Withdraw ${market.underlyingSymbol} collateral from Metronome`,
      req.userAddress
    ),
    metadata: {
      action:             "withdraw_collateral",
      depositToken:       req.depositTokenAddress,
      depositTokenSymbol: market.symbol,
      underlyingSymbol:   market.underlyingSymbol,
      amount:             amount.toString(),
      recipient,
    },
  };
}
