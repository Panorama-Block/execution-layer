import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { avaxService } from "../../../shared/services/avax.service";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, BENQI_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { getMarketByQToken } from "../config/avax-lending-markets";

export interface PrepareSupplyRequest {
  userAddress:  string;
  qTokenAddress: string;
  amount:       string; // in wei / base units
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

export async function executePrepareSupply(req: PrepareSupplyRequest): Promise<PrepareSupplyResponse> {
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

  if (market.isNative) {
    // supplyAVAX(address user) — native AVAX sent as msg.value
    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address"],
      [req.userAddress]
    );

    builder.addExecute(
      protocolId,
      BENQI_SELECTORS.SUPPLY_AVAX,
      [],
      deadline,
      adapterData,
      amount,
      executorAddr,
      `Supply ${ethers.formatEther(amount)} AVAX to Benqi`
    );
  } else {
    // approve underlying → executor
    const allowance = await avaxService.checkAllowance(market.underlyingAddress!, req.userAddress, executorAddr, amount);
    builder.addApproveIfNeeded(
      market.underlyingAddress!,
      executorAddr,
      allowance,
      amount,
      `Approve ${market.underlyingSymbol} for PanoramaExecutor`
    );

    // supply(address qToken, uint256 amount, address user)
    const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address"],
      [req.qTokenAddress, amount, req.userAddress]
    );

    builder.addExecute(
      protocolId,
      BENQI_SELECTORS.SUPPLY,
      [{ token: market.underlyingAddress!, amount }],
      deadline,
      adapterData,
      0n,
      executorAddr,
      `Supply ${market.underlyingSymbol} to Benqi`
    );
  }

  return {
    bundle: await builder.buildWithGas(`Supply ${market.underlyingSymbol} to Benqi on Avalanche`, req.userAddress),
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
