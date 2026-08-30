import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { avaxService } from "../../../shared/services/avax.service";
import { prepareEvidenceBoundBundle } from "../../../shared/services/evidence-bound-preparation.service";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, BENQI_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { getMarketByQToken } from "../config/avax-lending-markets";
import { getContract } from "../../../providers/chain.provider";
import { BENQI_TOKEN_ABI } from "../../../utils/abi";

export interface PrepareRedeemRequest {
  userAddress:   string;
  qTokenAddress: string;
  amount:        string; // underlying amount in wei (e.g. AVAX wei with 18 decimals)
}

export interface PrepareRedeemResponse {
  correlationId:        string;
  evidenceVersion:      string;
  evidenceEnabled:      boolean;
  preparedPayloadHash:  string;
  bundle:                TransactionBundle;
  metadata: {
    action:           "redeem";
    qTokenAddress:    string;
    qTokenSymbol:     string;
    underlyingSymbol: string;
    qTokenAmount:     string;
    isNative:         boolean;
  };
}

export async function executePrepareRedeem(req: PrepareRedeemRequest): Promise<PrepareRedeemResponse> {
  const chain        = getChainConfig("avalanche");
  const executorAddr = chain.contracts.panoramaExecutor;
  if (!executorAddr) throw new AppError("INTERNAL_ERROR", "PanoramaExecutor not deployed on Avalanche");

  const market = getMarketByQToken(req.qTokenAddress);
  if (!market) throw new AppError("POOL_NOT_FOUND", `Market not found for qToken: ${req.qTokenAddress}`);

  const underlyingAmount = BigInt(req.amount);
  if (underlyingAmount <= 0n) throw new AppError("INVALID_AMOUNT", "amount must be positive");

  return prepareEvidenceBoundBundle({
    intent: {
      action: "redeem",
      chainId: chain.chainId,
      network: "avalanche-c-chain",
      walletAddress: req.userAddress,
      assetIn: req.qTokenAddress,
      assetOut:
        market.underlyingAddress ??
        market.underlyingSymbol,
      amountRaw: req.amount,
    },
    prepare: async () => {
      // Convert requested underlying amount → qToken amount using
      // Benqi's current exchange rate.
      // Compound-fork formula:
      // qTokenAmount = underlyingWei * 1e18 / exchangeRate
      const qTokenContract = getContract(
        req.qTokenAddress,
        BENQI_TOKEN_ABI,
        "avalanche"
      );

      const [
        exchangeRate,
        userQTokenBalance,
      ] = await Promise.all([
        qTokenContract.exchangeRateStored() as Promise<bigint>,
        qTokenContract.balanceOf(
          req.userAddress
        ) as Promise<bigint>,
      ]);

      let qTokenAmount =
        (underlyingAmount * BigInt(1e18)) /
        exchangeRate;

      // Cap at the wallet's actual balance to handle full-withdrawal
      // rounding at the protocol exchange rate.
      if (qTokenAmount > userQTokenBalance) {
        qTokenAmount = userQTokenBalance;
      }

      if (qTokenAmount <= 0n) {
        throw new AppError(
          "INVALID_AMOUNT",
          "Derived qTokenAmount is zero — position may be empty"
        );
      }

      const protocolId = encodeProtocolId("benqi");
      const builder = new BundleBuilder(chain.chainId);
      const deadline = getDeadline(20);

      // Approve qToken → executor so it can pull qTokens to the proxy
      const allowance = await avaxService.checkAllowance(
        req.qTokenAddress,
        req.userAddress,
        executorAddr,
        qTokenAmount
      );

      builder.addApproveIfNeeded(
        req.qTokenAddress,
        executorAddr,
        allowance,
        qTokenAmount,
        `Approve ${market.qTokenSymbol} for PanoramaExecutor`
      );

      if (market.isNative) {
        // redeemAVAX(uint256 qTokenAmount, address recipient)
        const adapterData =
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256", "address"],
            [qTokenAmount, req.userAddress]
          );

        builder.addExecute(
          protocolId,
          BENQI_SELECTORS.REDEEM_AVAX,
          [{
            token: req.qTokenAddress,
            amount: qTokenAmount,
          }],
          deadline,
          adapterData,
          0n,
          executorAddr,
          `Redeem ${market.qTokenSymbol} for AVAX via Benqi`
        );
      } else {
        // redeem(address qToken, uint256 qTokenAmount, address recipient)
        const adapterData =
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "address"],
            [
              req.qTokenAddress,
              qTokenAmount,
              req.userAddress,
            ]
          );

        builder.addExecute(
          protocolId,
          BENQI_SELECTORS.REDEEM,
          [{
            token: req.qTokenAddress,
            amount: qTokenAmount,
          }],
          deadline,
          adapterData,
          0n,
          executorAddr,
          `Redeem ${market.qTokenSymbol} for ${market.underlyingSymbol} via Benqi`
        );
      }

      const bundle = await builder.buildWithGas(
        `Redeem ${market.qTokenSymbol} on Avalanche`,
        req.userAddress
      );

      const metadata = {
        action: "redeem" as const,
        qTokenAddress: req.qTokenAddress,
        qTokenSymbol: market.qTokenSymbol,
        underlyingSymbol: market.underlyingSymbol,
        qTokenAmount: qTokenAmount.toString(),
        isNative: market.isNative,
      };

      return {
        bundle,
        metadata,
      };
    },
  });
}
