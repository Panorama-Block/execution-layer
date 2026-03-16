import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { avaxService } from "../../../shared/services/avax.service";
import { PANORAMA_LEND_ABI } from "../../../utils/abi";
import { BundleBuilder } from "../../../shared/bundle-builder";
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

const LEND_IFACE = new ethers.Interface(PANORAMA_LEND_ABI);

export async function executePrepareRepay(req: PrepareRepayRequest): Promise<PrepareRepayResponse> {
  const chain    = getChainConfig("avalanche");
  const lendAddr = chain.contracts.panoramaLend;
  if (!lendAddr) throw new AppError("INTERNAL_ERROR", "PanoramaLend not deployed yet");

  const market = getMarketByQToken(req.qTokenAddress);
  if (!market) throw new AppError("POOL_NOT_FOUND", `Market not found for qToken: ${req.qTokenAddress}`);

  const amount = BigInt(req.amount);
  if (amount <= 0n) throw new AppError("INVALID_AMOUNT", "amount must be positive");

  const builder = new BundleBuilder(chain.chainId);

  if (market.isNative) {
    // repayAVAX() payable — no approval needed
    builder["steps"].push({
      to:          lendAddr,
      data:        LEND_IFACE.encodeFunctionData("repayAVAX"),
      value:       amount.toString(),
      chainId:     chain.chainId,
      description: `Repay ${ethers.formatEther(amount)} AVAX to Benqi via PanoramaLend`,
    });
  } else {
    // approve underlying → PanoramaLend (if needed)
    const allowance = await avaxService.checkAllowance(market.underlyingAddress!, req.userAddress, lendAddr, amount);
    builder.addApproveIfNeeded(
      market.underlyingAddress!,
      lendAddr,
      allowance,
      amount,
      `Approve ${market.underlyingSymbol} for PanoramaLend repay`
    );

    builder["steps"].push({
      to:          lendAddr,
      data:        LEND_IFACE.encodeFunctionData("repay", [req.qTokenAddress, amount]),
      value:       "0",
      chainId:     chain.chainId,
      description: `Repay ${market.underlyingSymbol} to Benqi via PanoramaLend`,
    });
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
