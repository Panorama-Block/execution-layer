import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, METRONOME_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { getContract } from "../../../providers/chain.provider";
import { ERC20_ABI } from "../../../utils/abi";
import {
  getCollateralMarketByDepositToken,
  getSyntheticMarketByDebtToken,
} from "../config/metronome-markets";

export interface PrepareUnwindRequest {
  userAddress:         string;
  debtTokenAddress:    string; // Metronome DebtToken (synth side)
  depositTokenAddress: string; // Metronome DepositToken (collateral side)
  synthAmount:         string; // synth base units the user funds — must cover full debt + fee
  recipient?:          string; // defaults to userAddress (gets collateral + synth dust)
}

export interface PrepareUnwindResponse {
  bundle:   TransactionBundle;
  metadata: {
    action:             "unwind";
    debtToken:          string;
    synth:              string;
    synthSymbol:        string;
    depositToken:       string;
    depositTokenSymbol: string;
    underlyingSymbol:   string;
    synthAmount:        string;
    recipient:          string;
  };
}

export async function executePrepareUnwind(
  req: PrepareUnwindRequest
): Promise<PrepareUnwindResponse> {
  const chain        = getChainConfig("base");
  const executorAddr = chain.contracts.panoramaExecutor;
  if (!executorAddr) throw new AppError("INTERNAL_ERROR", "PanoramaExecutor not deployed on Base");

  const synthMarket = getSyntheticMarketByDebtToken(req.debtTokenAddress);
  if (!synthMarket) {
    throw new AppError(
      "POOL_NOT_FOUND",
      `Metronome synthetic market not found for debtToken: ${req.debtTokenAddress}`
    );
  }

  const collateralMarket = getCollateralMarketByDepositToken(req.depositTokenAddress);
  if (!collateralMarket) {
    throw new AppError(
      "POOL_NOT_FOUND",
      `Metronome collateral market not found for depositToken: ${req.depositTokenAddress}`
    );
  }

  const synthAmount = BigInt(req.synthAmount);
  if (synthAmount <= 0n) throw new AppError("INVALID_AMOUNT", "synthAmount must be positive");

  const recipient  = req.recipient ?? req.userAddress;
  const protocolId = encodeProtocolId("metronome");
  const builder    = new BundleBuilder(chain.chainId);
  const deadline   = getDeadline(20);

  // Executor pulls the synthetic from the user so the proxy has enough to burn
  // against the full debt inside `unwind`.
  const synth = getContract(synthMarket.synth, ERC20_ABI, "base");
  const allowance: bigint = await synth.allowance(req.userAddress, executorAddr);
  builder.addApproveIfNeeded(
    synthMarket.synth,
    executorAddr,
    allowance,
    synthAmount,
    `Approve ${synthMarket.symbol} for PanoramaExecutor`
  );

  // unwind(address debtToken, address depositToken, address recipient)
  const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address"],
    [req.debtTokenAddress, req.depositTokenAddress, recipient]
  );

  builder.addExecute(
    protocolId,
    METRONOME_SELECTORS.UNWIND,
    [{ token: synthMarket.synth, amount: synthAmount }],
    deadline,
    adapterData,
    0n,
    executorAddr,
    `Unwind ${synthMarket.symbol} / ${collateralMarket.underlyingSymbol} position on Metronome`
  );

  return {
    bundle: await builder.buildWithGas(
      `Unwind ${synthMarket.symbol} / ${collateralMarket.underlyingSymbol} position on Metronome`,
      req.userAddress
    ),
    metadata: {
      action:             "unwind",
      debtToken:          req.debtTokenAddress,
      synth:              synthMarket.synth,
      synthSymbol:        synthMarket.symbol,
      depositToken:       req.depositTokenAddress,
      depositTokenSymbol: collateralMarket.symbol,
      underlyingSymbol:   collateralMarket.underlyingSymbol,
      synthAmount:        synthAmount.toString(),
      recipient,
    },
  };
}
