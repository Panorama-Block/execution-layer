import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { getContract } from "../../../providers/chain.provider";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, MOONWELL_SELECTORS } from "../../../shared/bundle-builder";
import { ERC20_ABI } from "../../../utils/abi";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { getMarketByMToken } from "../config/moonwell-markets";

export interface PrepareRepayRequest {
  userAddress:   string;
  mTokenAddress: string;
  /** Amount of underlying to repay in wei. */
  amount:        string;
  /** When true, repay WETH borrow using native ETH (wraps internally). */
  useNativeETH?: boolean;
}

export interface PrepareRepayResponse {
  bundle:   TransactionBundle;
  metadata: {
    action:           "repay";
    mTokenAddress:    string;
    mTokenSymbol:     string;
    underlyingSymbol: string;
    amount:           string;
    useNativeETH:     boolean;
  };
}

export async function executePrepareRepay(req: PrepareRepayRequest): Promise<PrepareRepayResponse> {
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

  if (useNativeETH) {
    // repayETH(address mWETH) — sends ETH as msg.value, wraps internally
    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address"],
      [req.mTokenAddress]
    );

    builder.addExecute(
      protocolId,
      MOONWELL_SELECTORS.REPAY_ETH,
      [],
      deadline,
      adapterData,
      amount,
      executorAddr,
      `Repay ${ethers.formatEther(amount)} ETH to Moonwell`
    );
  } else {
    // ERC20 repay: approve underlying → executor, then repay(mToken, amount)
    const erc20 = getContract(market.underlyingAddress, ERC20_ABI, "base");
    const allowance: bigint = await erc20.allowance(req.userAddress, executorAddr);
    builder.addApproveIfNeeded(
      market.underlyingAddress,
      executorAddr,
      allowance,
      amount,
      `Approve ${market.underlyingSymbol} for PanoramaExecutor repay`
    );

    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [req.mTokenAddress, amount]
    );

    builder.addExecute(
      protocolId,
      MOONWELL_SELECTORS.REPAY,
      [{ token: market.underlyingAddress, amount }],
      deadline,
      adapterData,
      0n,
      executorAddr,
      `Repay ${market.underlyingSymbol} to Moonwell`
    );
  }

  return {
    bundle: await builder.buildWithGas(`Repay ${market.underlyingSymbol} to Moonwell on Base`, req.userAddress),
    metadata: {
      action:           "repay",
      mTokenAddress:    req.mTokenAddress,
      mTokenSymbol:     market.mTokenSymbol,
      underlyingSymbol: market.underlyingSymbol,
      amount:           amount.toString(),
      useNativeETH,
    },
  };
}
