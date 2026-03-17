import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { PANORAMA_LEND_ABI } from "../../../utils/abi";
import { BundleBuilder } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { getMarketByQToken } from "../config/avax-lending-markets";

export interface PrepareBorrowRequest {
  userAddress:   string;
  qTokenAddress: string;
  amount:        string; // amount of underlying to borrow
}

export interface PrepareBorrowResponse {
  bundle:   TransactionBundle;
  metadata: {
    action:           "borrow";
    qTokenAddress:    string;
    qTokenSymbol:     string;
    underlyingSymbol: string;
    amount:           string;
    isNative:         boolean;
  };
}

const LEND_IFACE = new ethers.Interface(PANORAMA_LEND_ABI);

export async function executePrepareBorrow(req: PrepareBorrowRequest): Promise<PrepareBorrowResponse> {
  const chain    = getChainConfig("avalanche");
  const lendAddr = chain.contracts.panoramaLend;
  if (!lendAddr) throw new AppError("INTERNAL_ERROR", "PanoramaLend not deployed yet");

  const market = getMarketByQToken(req.qTokenAddress);
  if (!market) throw new AppError("POOL_NOT_FOUND", `Market not found for qToken: ${req.qTokenAddress}`);

  const amount = BigInt(req.amount);
  if (amount <= 0n) throw new AppError("INVALID_AMOUNT", "amount must be positive");

  const builder = new BundleBuilder(chain.chainId);

  // Borrow requires no token approval — contract sends tokens/AVAX to caller
  if (market.isNative) {
    builder["steps"].push({
      to:          lendAddr,
      data:        LEND_IFACE.encodeFunctionData("borrowAVAX", [amount]),
      value:       "0",
      chainId:     chain.chainId,
      description: `Borrow ${ethers.formatEther(amount)} AVAX from Benqi via PanoramaLend`,
    });
  } else {
    builder["steps"].push({
      to:          lendAddr,
      data:        LEND_IFACE.encodeFunctionData("borrow", [req.qTokenAddress, amount]),
      value:       "0",
      chainId:     chain.chainId,
      description: `Borrow ${market.underlyingSymbol} from Benqi via PanoramaLend`,
    });
  }

  return {
    bundle: builder.build(`Borrow ${market.underlyingSymbol} from Benqi on Avalanche`),
    metadata: {
      action:           "borrow",
      qTokenAddress:    req.qTokenAddress,
      qTokenSymbol:     market.qTokenSymbol,
      underlyingSymbol: market.underlyingSymbol,
      amount:           amount.toString(),
      isNative:         market.isNative,
    },
  };
}
