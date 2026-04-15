import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { getContract } from "../../../providers/chain.provider";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, MOONWELL_SELECTORS } from "../../../shared/bundle-builder";
import { ERC20_ABI } from "../../../utils/abi";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { getMarketByMToken } from "../config/moonwell-markets";

export interface PrepareSupplyRequest {
  userAddress:   string;
  mTokenAddress: string;
  amount:        string; // underlying amount in wei; ignored when useNativeETH=true
  /** When true, supply native ETH to mWETH via supplyETH (value = amount). */
  useNativeETH?: boolean;
}

export interface PrepareSupplyResponse {
  bundle:   TransactionBundle;
  metadata: {
    action:             "supply";
    mTokenAddress:      string;
    mTokenSymbol:       string;
    underlyingSymbol:   string;
    amount:             string;
    useNativeETH:       boolean;
  };
}

export async function executePrepareSupply(req: PrepareSupplyRequest): Promise<PrepareSupplyResponse> {
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
    // supplyETH(address mWETH, address recipient) — sends ETH as msg.value
    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address"],
      [req.mTokenAddress, req.userAddress]
    );

    builder.addExecute(
      protocolId,
      MOONWELL_SELECTORS.SUPPLY_ETH,
      [],
      deadline,
      adapterData,
      amount,
      executorAddr,
      `Supply ${ethers.formatEther(amount)} ETH to Moonwell`
    );
  } else {
    // ERC20 supply: approve underlying → executor, then supply(mToken, amount, recipient)
    const erc20  = getContract(market.underlyingAddress, ERC20_ABI, "base");
    const allowance: bigint = await erc20.allowance(req.userAddress, executorAddr);
    builder.addApproveIfNeeded(
      market.underlyingAddress,
      executorAddr,
      allowance,
      amount,
      `Approve ${market.underlyingSymbol} for PanoramaExecutor`
    );

    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address"],
      [req.mTokenAddress, amount, req.userAddress]
    );

    builder.addExecute(
      protocolId,
      MOONWELL_SELECTORS.SUPPLY,
      [{ token: market.underlyingAddress, amount }],
      deadline,
      adapterData,
      0n,
      executorAddr,
      `Supply ${market.underlyingSymbol} to Moonwell`
    );
  }

  return {
    bundle: await builder.buildWithGas(`Supply ${market.underlyingSymbol} to Moonwell on Base`, req.userAddress),
    metadata: {
      action:           "supply",
      mTokenAddress:    req.mTokenAddress,
      mTokenSymbol:     market.mTokenSymbol,
      underlyingSymbol: market.underlyingSymbol,
      amount:           amount.toString(),
      useNativeETH,
    },
  };
}
