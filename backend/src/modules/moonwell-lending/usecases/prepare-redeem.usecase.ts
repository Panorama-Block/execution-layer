import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { getContract } from "../../../providers/chain.provider";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, MOONWELL_SELECTORS } from "../../../shared/bundle-builder";
import { ERC20_ABI } from "../../../utils/abi";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { getMarketByMToken } from "../config/moonwell-markets";

export interface PrepareRedeemRequest {
  userAddress:   string;
  mTokenAddress: string;
  /** Amount of mTokens to redeem (not underlying). */
  amount:        string;
  /** When true, redeem mWETH and unwrap to native ETH via redeemETH. */
  useNativeETH?: boolean;
}

export interface PrepareRedeemResponse {
  bundle:   TransactionBundle;
  metadata: {
    action:           "redeem";
    mTokenAddress:    string;
    mTokenSymbol:     string;
    underlyingSymbol: string;
    amount:           string;
    useNativeETH:     boolean;
  };
}

export async function executePrepareRedeem(req: PrepareRedeemRequest): Promise<PrepareRedeemResponse> {
  const chain        = getChainConfig("base");
  const executorAddr = chain.contracts.panoramaExecutor;
  if (!executorAddr) throw new AppError("INTERNAL_ERROR", "PanoramaExecutor not deployed on Base");

  const market = getMarketByMToken(req.mTokenAddress);
  if (!market) throw new AppError("POOL_NOT_FOUND", `Market not found for mToken: ${req.mTokenAddress}`);

  const mTokenAmount = BigInt(req.amount);
  if (mTokenAmount <= 0n) throw new AppError("INVALID_AMOUNT", "amount must be positive");

  const useNativeETH = req.useNativeETH === true && market.supportsEthVariant;
  const protocolId   = encodeProtocolId("moonwell");
  const builder      = new BundleBuilder(chain.chainId);
  const deadline     = getDeadline(20);

  // Always approve mTokens to executor first
  const erc20 = getContract(req.mTokenAddress, ERC20_ABI, "base");
  const allowance: bigint = await erc20.allowance(req.userAddress, executorAddr);
  builder.addApproveIfNeeded(
    req.mTokenAddress,
    executorAddr,
    allowance,
    mTokenAmount,
    `Approve ${market.mTokenSymbol} for PanoramaExecutor`
  );

  if (useNativeETH) {
    // redeemETH(address mWETH, uint256 mTokenAmount, address recipient)
    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address"],
      [req.mTokenAddress, mTokenAmount, req.userAddress]
    );

    builder.addExecute(
      protocolId,
      MOONWELL_SELECTORS.REDEEM_ETH,
      [{ token: req.mTokenAddress, amount: mTokenAmount }],
      deadline,
      adapterData,
      0n,
      executorAddr,
      `Redeem ${market.mTokenSymbol} → ETH from Moonwell`
    );
  } else {
    // redeem(address mToken, uint256 mTokenAmount, address recipient)
    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address"],
      [req.mTokenAddress, mTokenAmount, req.userAddress]
    );

    builder.addExecute(
      protocolId,
      MOONWELL_SELECTORS.REDEEM,
      [{ token: req.mTokenAddress, amount: mTokenAmount }],
      deadline,
      adapterData,
      0n,
      executorAddr,
      `Redeem ${market.mTokenSymbol} → ${market.underlyingSymbol} from Moonwell`
    );
  }

  return {
    bundle: await builder.buildWithGas(`Redeem ${market.mTokenSymbol} from Moonwell on Base`, req.userAddress),
    metadata: {
      action:           "redeem",
      mTokenAddress:    req.mTokenAddress,
      mTokenSymbol:     market.mTokenSymbol,
      underlyingSymbol: market.underlyingSymbol,
      amount:           mTokenAmount.toString(),
      useNativeETH,
    },
  };
}
