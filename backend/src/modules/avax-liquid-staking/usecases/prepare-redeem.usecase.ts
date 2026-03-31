import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, SAVAX_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";

export interface PrepareRedeemRequest {
  userAddress: string;
  userUnlockIndex: number; // index returned by requestUnlock
}

export interface PrepareRedeemResponse {
  bundle: TransactionBundle;
  metadata: {
    action: "redeem";
    userUnlockIndex: number;
  };
}

export async function executePrepareRedeem(req: PrepareRedeemRequest): Promise<PrepareRedeemResponse> {
  const chain        = getChainConfig("avalanche");
  const executorAddr = chain.contracts.panoramaExecutor;
  if (!executorAddr) throw new AppError("INTERNAL_ERROR", "PanoramaExecutor not deployed on Avalanche");

  if (req.userUnlockIndex < 0) throw new AppError("INVALID_AMOUNT", "userUnlockIndex must be >= 0");

  const protocolId = encodeProtocolId("savax");
  const builder    = new BundleBuilder(chain.chainId);
  const deadline   = getDeadline(20);

  // redeem(uint256 unlockIndex, address recipient)
  const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address"],
    [req.userUnlockIndex, req.userAddress]
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

  return {
    bundle: await builder.buildWithGas(`Redeem AVAX from unlock request #${req.userUnlockIndex}`, req.userAddress),
    metadata: {
      action: "redeem",
      userUnlockIndex: req.userUnlockIndex,
    },
  };
}
