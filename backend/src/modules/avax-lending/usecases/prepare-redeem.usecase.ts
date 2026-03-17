import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { avaxService } from "../../../shared/services/avax.service";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, BENQI_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { getMarketByQToken } from "../config/avax-lending-markets";

export interface PrepareRedeemRequest {
  userAddress:   string;
  qTokenAddress: string;
  qTokenAmount:  string; // amount of qTokens to redeem
}

export interface PrepareRedeemResponse {
  bundle:   TransactionBundle;
  metadata: {
    action:           "redeem";
    qTokenAddress:    string;
    qTokenSymbol:     string;
    underlyingSymbol: string;
    qTokenAmount:     string;
    isNative:         boolean;
  };
}

export async function executePrepareRedeem(req: PrepareRedeemRequest): Promise<PrepareRedeemResponse> {
  const chain        = getChainConfig("avalanche");
  const executorAddr = chain.contracts.panoramaExecutor;
  if (!executorAddr) throw new AppError("INTERNAL_ERROR", "PanoramaExecutor not deployed on Avalanche");

  const market = getMarketByQToken(req.qTokenAddress);
  if (!market) throw new AppError("POOL_NOT_FOUND", `Market not found for qToken: ${req.qTokenAddress}`);

  const qTokenAmount = BigInt(req.qTokenAmount);
  if (qTokenAmount <= 0n) throw new AppError("INVALID_AMOUNT", "qTokenAmount must be positive");

  const protocolId = encodeProtocolId("benqi");
  const builder    = new BundleBuilder(chain.chainId);
  const deadline   = getDeadline(20);

  // Approve qToken → executor so it can pull qTokens to the proxy
  const allowance = await avaxService.checkAllowance(req.qTokenAddress, req.userAddress, executorAddr, qTokenAmount);
  builder.addApproveIfNeeded(
    req.qTokenAddress,
    executorAddr,
    allowance,
    qTokenAmount,
    `Approve ${market.qTokenSymbol} for PanoramaExecutor`
  );

  if (market.isNative) {
    // redeemAVAX(uint256 qTokenAmount, address recipient)
    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address"],
      [qTokenAmount, req.userAddress]
    );

    builder.addExecute(
      protocolId,
      BENQI_SELECTORS.REDEEM_AVAX,
      [{ token: req.qTokenAddress, amount: qTokenAmount }],
      deadline,
      adapterData,
      0n,
      executorAddr,
      `Redeem ${market.qTokenSymbol} for AVAX via Benqi`
    );
  } else {
    // redeem(address qToken, uint256 qTokenAmount, address recipient)
    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address"],
      [req.qTokenAddress, qTokenAmount, req.userAddress]
    );

    builder.addExecute(
      protocolId,
      BENQI_SELECTORS.REDEEM,
      [{ token: req.qTokenAddress, amount: qTokenAmount }],
      deadline,
      adapterData,
      0n,
      executorAddr,
      `Redeem ${market.qTokenSymbol} for ${market.underlyingSymbol} via Benqi`
    );
  }

  return {
    bundle: builder.build(`Redeem ${market.qTokenSymbol} on Avalanche`),
    metadata: {
      action:           "redeem",
      qTokenAddress:    req.qTokenAddress,
      qTokenSymbol:     market.qTokenSymbol,
      underlyingSymbol: market.underlyingSymbol,
      qTokenAmount:     qTokenAmount.toString(),
      isNative:         market.isNative,
    },
  };
}
