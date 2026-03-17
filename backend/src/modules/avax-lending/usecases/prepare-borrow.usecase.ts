import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, BENQI_SELECTORS } from "../../../shared/bundle-builder";
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

export async function executePrepareBorrow(req: PrepareBorrowRequest): Promise<PrepareBorrowResponse> {
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

  // Borrow requires no token transfer from user — the adapter borrows and sends to recipient
  if (market.isNative) {
    // borrowAVAX(uint256 amount, address recipient)
    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address"],
      [amount, req.userAddress]
    );

    builder.addExecute(
      protocolId,
      BENQI_SELECTORS.BORROW_AVAX,
      [],
      deadline,
      adapterData,
      0n,
      executorAddr,
      `Borrow ${ethers.formatEther(amount)} AVAX from Benqi`
    );
  } else {
    // borrow(address qToken, uint256 amount, address recipient)
    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address"],
      [req.qTokenAddress, amount, req.userAddress]
    );

    builder.addExecute(
      protocolId,
      BENQI_SELECTORS.BORROW,
      [],
      deadline,
      adapterData,
      0n,
      executorAddr,
      `Borrow ${market.underlyingSymbol} from Benqi`
    );
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
