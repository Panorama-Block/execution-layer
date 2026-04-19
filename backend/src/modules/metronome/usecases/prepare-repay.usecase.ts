import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, METRONOME_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { getContract } from "../../../providers/chain.provider";
import { ERC20_ABI } from "../../../utils/abi";
import { getSyntheticMarketByDebtToken } from "../config/metronome-markets";

export interface PrepareRepayRequest {
  userAddress:      string;
  debtTokenAddress: string; // Metronome DebtToken for the synthetic being repaid
  amount:           string; // synth base units to burn
}

export interface PrepareRepayResponse {
  bundle:   TransactionBundle;
  metadata: {
    action:      "repay_synth";
    debtToken:   string;
    synth:       string;
    synthSymbol: string;
    amount:      string;
  };
}

export async function executePrepareRepay(
  req: PrepareRepayRequest
): Promise<PrepareRepayResponse> {
  const chain        = getChainConfig("base");
  const executorAddr = chain.contracts.panoramaExecutor;
  if (!executorAddr) throw new AppError("INTERNAL_ERROR", "PanoramaExecutor not deployed on Base");

  const market = getSyntheticMarketByDebtToken(req.debtTokenAddress);
  if (!market) {
    throw new AppError(
      "POOL_NOT_FOUND",
      `Metronome synthetic market not found for debtToken: ${req.debtTokenAddress}`
    );
  }

  const amount = BigInt(req.amount);
  if (amount <= 0n) throw new AppError("INVALID_AMOUNT", "amount must be positive");

  const protocolId = encodeProtocolId("metronome");
  const builder    = new BundleBuilder(chain.chainId);
  const deadline   = getDeadline(20);

  // Executor pulls synthetic from the user into the proxy before dispatching.
  const synth = getContract(market.synth, ERC20_ABI, "base");
  const allowance: bigint = await synth.allowance(req.userAddress, executorAddr);
  builder.addApproveIfNeeded(
    market.synth,
    executorAddr,
    allowance,
    amount,
    `Approve ${market.symbol} for PanoramaExecutor`
  );

  // repaySynth(address debtToken, uint256 amount)
  const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256"],
    [req.debtTokenAddress, amount]
  );

  builder.addExecute(
    protocolId,
    METRONOME_SELECTORS.REPAY_SYNTH,
    [{ token: market.synth, amount }],
    deadline,
    adapterData,
    0n,
    executorAddr,
    `Repay ${market.symbol} debt on Metronome`
  );

  return {
    bundle: await builder.buildWithGas(
      `Repay ${market.symbol} debt on Metronome`,
      req.userAddress
    ),
    metadata: {
      action:      "repay_synth",
      debtToken:   req.debtTokenAddress,
      synth:       market.synth,
      synthSymbol: market.symbol,
      amount:      amount.toString(),
    },
  };
}
