import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, SAVAX_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import {
  prepareEvidenceBoundBundle,
} from "../../../shared/services/evidence-bound-preparation.service";

export interface PrepareStakeRequest {
  userAddress: string;
  amount: string; // AVAX amount in wei
}

export interface PrepareStakeResponse {
  correlationId: string;
  evidenceVersion: string;
  evidenceEnabled: boolean;
  preparedPayloadHash: string;
  bundle: TransactionBundle;
  metadata: {
    action: "stake";
    avaxAmount: string;
    estimatedSAvax: string;
  };
}

export async function executePrepareStake(
  req: PrepareStakeRequest
): Promise<PrepareStakeResponse> {
  const chain = getChainConfig("avalanche");
  const executorAddr = chain.contracts.panoramaExecutor;

  if (!executorAddr) {
    throw new AppError(
      "INTERNAL_ERROR",
      "PanoramaExecutor not deployed on Avalanche"
    );
  }

  const amount = BigInt(req.amount);

  if (amount <= 0n) {
    throw new AppError(
      "INVALID_AMOUNT",
      "amount must be positive"
    );
  }

  return prepareEvidenceBoundBundle({
    intent: {
      action: "stake",
      chainId: chain.chainId,
      network: "avalanche-c-chain",
      walletAddress: req.userAddress,
      assetIn: "AVAX",
      assetOut: "0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE",
      amountRaw: amount.toString(),
    },

    prepare: async () => {
      const protocolId = encodeProtocolId("savax");
      const builder = new BundleBuilder(chain.chainId);
      const deadline = getDeadline(20);

      const adapterData = ethers.AbiCoder
        .defaultAbiCoder()
        .encode(
          ["address"],
          [req.userAddress]
        );

      builder.addExecute(
        protocolId,
        SAVAX_SELECTORS.STAKE,
        [],
        deadline,
        adapterData,
        amount,
        executorAddr,
        `Stake ${ethers.formatEther(amount)} AVAX → receive sAVAX via BENQI`
      );

      const bundle = await builder.buildWithGas(
        `Stake ${ethers.formatEther(amount)} AVAX for sAVAX`,
        req.userAddress
      );

      return {
        bundle,
        metadata: {
          action: "stake" as const,
          avaxAmount: amount.toString(),
          estimatedSAvax: amount.toString(),
        },
      };
    },
  });
}
