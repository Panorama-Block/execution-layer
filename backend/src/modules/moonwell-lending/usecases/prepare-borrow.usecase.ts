import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, MOONWELL_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { getMarketByMToken } from "../config/moonwell-markets";

export interface PrepareBorrowRequest {
  userAddress:   string;
  mTokenAddress: string;
  /** Amount of underlying to borrow in wei. */
  amount:        string;
  /** When true, borrow WETH from mWETH and unwrap to native ETH. */
  useNativeETH?: boolean;
}

export interface PrepareBorrowResponse {
  bundle:   TransactionBundle;
  metadata: {
    action:           "borrow";
    mTokenAddress:    string;
    mTokenSymbol:     string;
    underlyingSymbol: string;
    amount:           string;
    useNativeETH:     boolean;
  };
}

export async function executePrepareBorrow(req: PrepareBorrowRequest): Promise<PrepareBorrowResponse> {
  const chain        = getChainConfig("base");
  const executorAddr = chain.contracts.panoramaExecutor;
  if (!executorAddr) throw new AppError("INTERNAL_ERROR", "PanoramaExecutor not deployed on Base");

  const market = getMarketByMToken(req.mTokenAddress);
  if (!market) throw new AppError("POOL_NOT_FOUND", `Market not found for mToken: ${req.mTokenAddress}`);

  const amount = BigInt(req.amount);
  if (amount <= 0n) throw new AppError("INVALID_AMOUNT", "amount must be positive");

  const useNativeETH = req.useNativeETH === true && market.supportsEthVariant;
  const protocolId   = encodeProtocolId("moonwell");
  const builder      = new BundleBuilder(chain.chainId);
  const deadline     = getDeadline(20);

  // Borrow requires no token transfer from user — adapter borrows and sends to recipient.
  if (useNativeETH) {
    // borrowETH(address mWETH, uint256 amount, address recipient)
    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address"],
      [req.mTokenAddress, amount, req.userAddress]
    );

    builder.addExecute(
      protocolId,
      MOONWELL_SELECTORS.BORROW_ETH,
      [],
      deadline,
      adapterData,
      0n,
      executorAddr,
      `Borrow ${ethers.formatEther(amount)} ETH from Moonwell`
    );
  } else {
    // borrow(address mToken, uint256 amount, address recipient)
    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address"],
      [req.mTokenAddress, amount, req.userAddress]
    );

    builder.addExecute(
      protocolId,
      MOONWELL_SELECTORS.BORROW,
      [],
      deadline,
      adapterData,
      0n,
      executorAddr,
      `Borrow ${market.underlyingSymbol} from Moonwell`
    );
  }

  return {
    bundle: await builder.buildWithGas(`Borrow ${market.underlyingSymbol} from Moonwell on Base`, req.userAddress),
    metadata: {
      action:           "borrow",
      mTokenAddress:    req.mTokenAddress,
      mTokenSymbol:     market.mTokenSymbol,
      underlyingSymbol: market.underlyingSymbol,
      amount:           amount.toString(),
      useNativeETH,
    },
  };
}
