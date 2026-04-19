import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, METRONOME_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { getContract } from "../../../providers/chain.provider";
import { ERC20_ABI } from "../../../utils/abi";
import { getCollateralMarketByDepositToken } from "../config/metronome-markets";

export interface PrepareDepositRequest {
  userAddress:         string;
  depositTokenAddress: string; // Metronome DepositToken (e.g. USDCDepositToken)
  amount:              string; // in underlying base units
}

export interface PrepareDepositResponse {
  bundle:   TransactionBundle;
  metadata: {
    action:            "deposit_collateral";
    depositToken:      string;
    depositTokenSymbol: string;
    underlyingSymbol:  string;
    amount:            string;
  };
}

export async function executePrepareDeposit(
  req: PrepareDepositRequest
): Promise<PrepareDepositResponse> {
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

  const protocolId = encodeProtocolId("metronome");
  const builder    = new BundleBuilder(chain.chainId);
  const deadline   = getDeadline(20);

  // Check underlying allowance toward the executor — executor pulls tokens before
  // dispatching to the adapter.
  const underlying = getContract(market.underlying, ERC20_ABI, "base");
  const allowance: bigint = await underlying.allowance(req.userAddress, executorAddr);
  builder.addApproveIfNeeded(
    market.underlying,
    executorAddr,
    allowance,
    amount,
    `Approve ${market.underlyingSymbol} for PanoramaExecutor`
  );

  // depositCollateral(address depositToken, uint256 amount)
  const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256"],
    [req.depositTokenAddress, amount]
  );

  builder.addExecute(
    protocolId,
    METRONOME_SELECTORS.DEPOSIT_COLLATERAL,
    [{ token: market.underlying, amount }],
    deadline,
    adapterData,
    0n,
    executorAddr,
    `Deposit ${market.underlyingSymbol} as collateral on Metronome`
  );

  return {
    bundle: await builder.buildWithGas(
      `Deposit ${market.underlyingSymbol} collateral on Metronome`,
      req.userAddress
    ),
    metadata: {
      action:             "deposit_collateral",
      depositToken:       req.depositTokenAddress,
      depositTokenSymbol: market.symbol,
      underlyingSymbol:   market.underlyingSymbol,
      amount:             amount.toString(),
    },
  };
}
