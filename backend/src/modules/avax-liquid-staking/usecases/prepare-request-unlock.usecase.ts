import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { avaxService } from "../../../shared/services/avax.service";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, SAVAX_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import {
  prepareEvidenceBoundBundle,
} from "../../../shared/services/evidence-bound-preparation.service";

export interface PrepareRequestUnlockRequest {
  userAddress: string;
  sAvaxAmount: string; // sAVAX amount in wei
}

export interface PrepareRequestUnlockResponse {
  correlationId: string;
  evidenceVersion: string;
  evidenceEnabled: boolean;
  preparedPayloadHash: string;
  bundle: TransactionBundle;
  metadata: {
    action: "requestUnlock";
    sAvaxAmount: string;
    estimatedAvax: string;
    cooldownDays: number;
  };
}

const S_AVAX_ADDRESS =
  "0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE";

export async function executePrepareRequestUnlock(
  req: PrepareRequestUnlockRequest
): Promise<PrepareRequestUnlockResponse> {
  const chain = getChainConfig("avalanche");
  const executorAddr =
    chain.contracts.panoramaExecutor;

  if (!executorAddr) {
    throw new AppError(
      "INTERNAL_ERROR",
      "PanoramaExecutor not deployed on Avalanche"
    );
  }

  const sAvaxAmount =
    BigInt(req.sAvaxAmount);

  if (sAvaxAmount <= 0n) {
    throw new AppError(
      "INVALID_AMOUNT",
      "sAvaxAmount must be positive"
    );
  }

  return prepareEvidenceBoundBundle({
    intent: {
      action: "requestUnlock",
      chainId: chain.chainId,
      network: "avalanche-c-chain",
      walletAddress: req.userAddress,
      assetIn: S_AVAX_ADDRESS,
      assetOut: "AVAX",
      amountRaw: sAvaxAmount.toString(),
    },

    prepare: async () => {
      const protocolId =
        encodeProtocolId("savax");

      const builder =
        new BundleBuilder(chain.chainId);

      const deadline =
        getDeadline(20);

      const allowance =
        await avaxService.checkAllowance(
          S_AVAX_ADDRESS,
          req.userAddress,
          executorAddr,
          sAvaxAmount
        );

      builder.addApproveIfNeeded(
        S_AVAX_ADDRESS,
        executorAddr,
        allowance,
        sAvaxAmount,
        "Approve sAVAX for PanoramaExecutor"
      );

      const adapterData =
        ethers.AbiCoder
          .defaultAbiCoder()
          .encode(
            ["uint256"],
            [sAvaxAmount]
          );

      builder.addExecute(
        protocolId,
        SAVAX_SELECTORS.REQUEST_UNLOCK,
        [
          {
            token: S_AVAX_ADDRESS,
            amount: sAvaxAmount,
          },
        ],
        deadline,
        adapterData,
        0n,
        executorAddr,
        `Request unlock of ${ethers.formatEther(sAvaxAmount)} sAVAX (~15 day cooldown)`
      );

      const bundle =
        await builder.buildWithGas(
          `Request unlock ${ethers.formatEther(sAvaxAmount)} sAVAX`,
          req.userAddress
        );

      return {
        bundle,
        metadata: {
          action:
            "requestUnlock" as const,
          sAvaxAmount:
            sAvaxAmount.toString(),
          estimatedAvax:
            sAvaxAmount.toString(),
          cooldownDays: 15,
        },
      };
    },
  });
}
