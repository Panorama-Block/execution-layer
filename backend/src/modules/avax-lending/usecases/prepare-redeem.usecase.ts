import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { avaxService } from "../../../shared/services/avax.service";
import { PANORAMA_LEND_ABI } from "../../../utils/abi";
import { BundleBuilder } from "../../../shared/bundle-builder";
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

const LEND_IFACE = new ethers.Interface(PANORAMA_LEND_ABI);

export async function executePrepareRedeem(req: PrepareRedeemRequest): Promise<PrepareRedeemResponse> {
  const chain    = getChainConfig("avalanche");
  const lendAddr = chain.contracts.panoramaLend;
  if (!lendAddr) throw new AppError("INTERNAL_ERROR", "PanoramaLend not deployed yet");

  const market = getMarketByQToken(req.qTokenAddress);
  if (!market) throw new AppError("POOL_NOT_FOUND", `Market not found for qToken: ${req.qTokenAddress}`);

  const qTokenAmount = BigInt(req.qTokenAmount);
  if (qTokenAmount <= 0n) throw new AppError("INVALID_AMOUNT", "qTokenAmount must be positive");

  const builder = new BundleBuilder(chain.chainId);

  // Always need to approve qToken → PanoramaLend so contract can pull them
  const allowance = await avaxService.checkAllowance(req.qTokenAddress, req.userAddress, lendAddr, qTokenAmount);
  builder.addApproveIfNeeded(
    req.qTokenAddress,
    lendAddr,
    allowance,
    qTokenAmount,
    `Approve ${market.qTokenSymbol} for PanoramaLend`
  );

  if (market.isNative) {
    builder["steps"].push({
      to:          lendAddr,
      data:        LEND_IFACE.encodeFunctionData("redeemAVAX", [qTokenAmount]),
      value:       "0",
      chainId:     chain.chainId,
      description: `Redeem ${market.qTokenSymbol} for AVAX via PanoramaLend`,
    });
  } else {
    builder["steps"].push({
      to:          lendAddr,
      data:        LEND_IFACE.encodeFunctionData("redeem", [req.qTokenAddress, qTokenAmount]),
      value:       "0",
      chainId:     chain.chainId,
      description: `Redeem ${market.qTokenSymbol} for ${market.underlyingSymbol} via PanoramaLend`,
    });
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
