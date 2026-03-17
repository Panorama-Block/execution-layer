import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { avaxService } from "../../../shared/services/avax.service";
import { PANORAMA_LEND_ABI } from "../../../utils/abi";
import { BundleBuilder } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { getMarketByQToken, getEnabledMarkets } from "../config/avax-lending-markets";

export interface PrepareSupplyRequest {
  userAddress:  string;
  qTokenAddress: string;
  amount:       string; // in wei / base units (ignored for native AVAX — use amountAVAX)
}

export interface PrepareSupplyResponse {
  bundle:   TransactionBundle;
  metadata: {
    action:           "supply";
    qTokenAddress:    string;
    qTokenSymbol:     string;
    underlyingSymbol: string;
    amount:           string;
    isNative:         boolean;
  };
}

const LEND_IFACE = new ethers.Interface(PANORAMA_LEND_ABI);

export async function executePrepareSupply(req: PrepareSupplyRequest): Promise<PrepareSupplyResponse> {
  const chain    = getChainConfig("avalanche");
  const lendAddr = chain.contracts.panoramaLend;
  if (!lendAddr) throw new AppError("INTERNAL_ERROR", "PanoramaLend not deployed yet");

  const market = getMarketByQToken(req.qTokenAddress);
  if (!market) throw new AppError("POOL_NOT_FOUND", `Market not found for qToken: ${req.qTokenAddress}`);

  const amount  = BigInt(req.amount);
  if (amount <= 0n) throw new AppError("INVALID_AMOUNT", "amount must be positive");

  const builder = new BundleBuilder(chain.chainId);

  if (market.isNative) {
    // supplyAVAX() payable — no approval needed
    builder["steps"].push({
      to:          lendAddr,
      data:        LEND_IFACE.encodeFunctionData("supplyAVAX"),
      value:       amount.toString(),
      chainId:     chain.chainId,
      description: `Supply ${ethers.formatEther(amount)} AVAX to Benqi via PanoramaLend`,
    });
  } else {
    // approve underlying → PanoramaLend (if needed)
    const allowance = await avaxService.checkAllowance(market.underlyingAddress!, req.userAddress, lendAddr, amount);
    builder.addApproveIfNeeded(
      market.underlyingAddress!,
      lendAddr,
      allowance,
      amount,
      `Approve ${market.underlyingSymbol} for PanoramaLend`
    );

    builder["steps"].push({
      to:          lendAddr,
      data:        LEND_IFACE.encodeFunctionData("supply", [req.qTokenAddress, amount]),
      value:       "0",
      chainId:     chain.chainId,
      description: `Supply ${market.underlyingSymbol} to Benqi via PanoramaLend`,
    });
  }

  return {
    bundle: builder.build(`Supply ${market.underlyingSymbol} to Benqi on Avalanche`),
    metadata: {
      action:           "supply",
      qTokenAddress:    req.qTokenAddress,
      qTokenSymbol:     market.qTokenSymbol,
      underlyingSymbol: market.underlyingSymbol,
      amount:           amount.toString(),
      isNative:         market.isNative,
    },
  };
}
