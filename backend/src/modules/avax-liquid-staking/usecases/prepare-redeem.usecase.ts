import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, SAVAX_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import {
  prepareEvidenceBoundBundle,
} from "../../../shared/services/evidence-bound-preparation.service";

export interface PrepareRedeemRequest {
  userAddress: string;
  userUnlockIndex: number; // index returned by requestUnlock
}

export interface PrepareRedeemResponse {
  correlationId: string;
  evidenceVersion: string;
  evidenceEnabled: boolean;
  preparedPayloadHash: string;
  bundle: TransactionBundle;
  metadata: {
    action: "redeem";
    userUnlockIndex: number;
  };
}

export async function executePrepareRedeem(
  req: PrepareRedeemRequest
): Promise<PrepareRedeemResponse> {
  const chain = getChainConfig("avalanche");
  const executorAddr =
    chain.contracts.panoramaExecutor;

  if (!executorAddr) {
    throw new AppError(
      "INTERNAL_ERROR",
      "PanoramaExecutor not deployed on Avalanche"
    );
  }

  if (req.userUnlockIndex < 0) {
    throw new AppError(
      "INVALID_AMOUNT",
      "userUnlockIndex must be >= 0"
    );
  }

  return prepareEvidenceBoundBundle({
    intent: {
      action: "redeem",
      chainId: chain.chainId,
      network: "avalanche-c-chain",
      walletAddress: req.userAddress,
      assetIn: "sAVAX_UNLOCK_REQUEST",
      assetOut: "AVAX",
      amountRaw:
        req.userUnlockIndex.toString(),
    },

    prepare: async () => {
      const protocolId =
        encodeProtocolId("savax");

      const builder =
        new BundleBuilder(chain.chainId);

      const deadline =
        getDeadline(20);

      const adapterData =
        ethers.AbiCoder
          .defaultAbiCoder()
          .encode(
            ["uint256", "address"],
            [
              req.userUnlockIndex,
              req.userAddress,
            ]
          );

      builder.addExecute(
        protocolId,
        SAVAX_SELECTORS.REDEEM,
        [],
        deadline,
        adapterData,
        0n,
        executorAddr,
        `Redeem AVAX from unlock request #${req.userUnlockIndex}`
      );

      const bundle =
        await builder.buildWithGas(
          `Redeem AVAX from unlock request #${req.userUnlockIndex}`,
          req.userAddress
        );

      return {
        bundle,
        metadata: {
          action: "redeem" as const,
          userUnlockIndex:
            req.userUnlockIndex,
        },
      };
    },
  });
}
