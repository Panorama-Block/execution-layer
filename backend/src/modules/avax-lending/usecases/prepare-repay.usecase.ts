import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { avaxService } from "../../../shared/services/avax.service";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, BENQI_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { getMarketByQToken } from "../config/avax-lending-markets";

export interface PrepareRepayRequest {
  userAddress:   string;
  qTokenAddress: string;
  amount:        string; // amount of underlying to repay
}

export interface PrepareRepayResponse {
  bundle:   TransactionBundle;
  metadata: {
    action:           "repay";
    qTokenAddress:    string;
    qTokenSymbol:     string;
    underlyingSymbol: string;
    amount:           string;
    isNative:         boolean;
  };
}

export async function executePrepareRepay(req: PrepareRepayRequest): Promise<PrepareRepayResponse> {
  const chain        = getChainConfig("avalanche");
  const executorAddr = chain.contracts.panoramaExecutor;
  if (!executorAddr) throw new AppError("INTERNAL_ERROR", "PanoramaExecutor not deployed on Avalanche");

  const market = getMarketByQToken(req.qTokenAddress);
  if (!market) throw new AppError("POOL_NOT_FOUND", `Market not found for qToken: ${req.qTokenAddress}`);

  const amount = BigInt(req.amount);
  if (amount <= 0n) throw new AppError("INVALID_AMOUNT", "amount must be positive");

  const protocolId = encodeProtocolId("benqi");
  const builder    = new BundleBuilder(chain.chainId);
  const deadline   = getDeadline(20);

  if (market.isNative) {
    // repayAVAX() — native AVAX sent as msg.value, no params
    const adapterData = "0x";

    builder.addExecute(
      protocolId,
      BENQI_SELECTORS.REPAY_AVAX,
      [],
      deadline,
      adapterData,
      amount,
      executorAddr,
      `Repay ${ethers.formatEther(amount)} AVAX to Benqi`
    );
  } else {
    // approve underlying → executor
    const allowance = await avaxService.checkAllowance(market.underlyingAddress!, req.userAddress, executorAddr, amount);
    builder.addApproveIfNeeded(
      market.underlyingAddress!,
      executorAddr,
      allowance,
      amount,
      `Approve ${market.underlyingSymbol} for PanoramaExecutor repay`
    );

    // repay(address qToken, uint256 amount)
    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [req.qTokenAddress, amount]
    );

    builder.addExecute(
      protocolId,
      BENQI_SELECTORS.REPAY,
      [{ token: market.underlyingAddress!, amount }],
      deadline,
      adapterData,
      0n,
      executorAddr,
      `Repay ${market.underlyingSymbol} to Benqi`
    );
  }

  return {
    bundle: builder.build(`Repay ${market.underlyingSymbol} to Benqi on Avalanche`),
    metadata: {
      action:           "repay",
      qTokenAddress:    req.qTokenAddress,
      qTokenSymbol:     market.qTokenSymbol,
      underlyingSymbol: market.underlyingSymbol,
      amount:           amount.toString(),
      isNative:         market.isNative,
    },
  };
}
