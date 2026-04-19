import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, METRONOME_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { getSyntheticMarketByDebtToken } from "../config/metronome-markets";

export interface PrepareMintRequest {
  userAddress:      string;
  debtTokenAddress: string; // Metronome DebtToken for the synthetic to mint
  amount:           string; // synth base units (18 decimals for msUSD/msETH)
  recipient?:       string; // defaults to userAddress
}

export interface PrepareMintResponse {
  bundle:   TransactionBundle;
  metadata: {
    action:       "mint_synth";
    debtToken:    string;
    synth:        string;
    synthSymbol:  string;
    amount:       string;
    recipient:    string;
  };
}

export async function executePrepareMint(
  req: PrepareMintRequest
): Promise<PrepareMintResponse> {
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

  const recipient  = req.recipient ?? req.userAddress;
  const protocolId = encodeProtocolId("metronome");
  const builder    = new BundleBuilder(chain.chainId);
  const deadline   = getDeadline(20);

  // Mint draws against the collateral already held by the proxy — no transfers[] input.
  // mintSynth(address debtToken, uint256 amount, address recipient)
  const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256", "address"],
    [req.debtTokenAddress, amount, recipient]
  );

  builder.addExecute(
    protocolId,
    METRONOME_SELECTORS.MINT_SYNTH,
    [],
    deadline,
    adapterData,
    0n,
    executorAddr,
    `Mint ${market.symbol} on Metronome`
  );

  return {
    bundle: await builder.buildWithGas(
      `Mint ${market.symbol} on Metronome`,
      req.userAddress
    ),
    metadata: {
      action:      "mint_synth",
      debtToken:   req.debtTokenAddress,
      synth:       market.synth,
      synthSymbol: market.symbol,
      amount:      amount.toString(),
      recipient,
    },
  };
}
