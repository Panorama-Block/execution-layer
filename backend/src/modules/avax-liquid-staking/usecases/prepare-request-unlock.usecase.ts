import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { avaxService } from "../../../shared/services/avax.service";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, SAVAX_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";

export interface PrepareRequestUnlockRequest {
  userAddress: string;
  sAvaxAmount: string; // sAVAX amount in wei
}

export interface PrepareRequestUnlockResponse {
  bundle: TransactionBundle;
  metadata: {
    action: "requestUnlock";
    sAvaxAmount: string;
    estimatedAvax: string;
    cooldownDays: number;
  };
}

const S_AVAX_ADDRESS = "0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE";

export async function executePrepareRequestUnlock(req: PrepareRequestUnlockRequest): Promise<PrepareRequestUnlockResponse> {
  const chain        = getChainConfig("avalanche");
  const executorAddr = chain.contracts.panoramaExecutor;
  if (!executorAddr) throw new AppError("INTERNAL_ERROR", "PanoramaExecutor not deployed on Avalanche");

  const sAvaxAmount = BigInt(req.sAvaxAmount);
  if (sAvaxAmount <= 0n) throw new AppError("INVALID_AMOUNT", "sAvaxAmount must be positive");

  const protocolId = encodeProtocolId("savax");
  const builder    = new BundleBuilder(chain.chainId);
  const deadline   = getDeadline(20);

  // Approve sAVAX → executor so it can pull to the proxy
  const allowance = await avaxService.checkAllowance(S_AVAX_ADDRESS, req.userAddress, executorAddr, sAvaxAmount);
  builder.addApproveIfNeeded(
    S_AVAX_ADDRESS,
    executorAddr,
    allowance,
    sAvaxAmount,
    "Approve sAVAX for PanoramaExecutor"
  );

  // requestUnlock(uint256 shareAmount)
  const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256"],
    [sAvaxAmount]
  );

  builder.addExecute(
    protocolId,
    SAVAX_SELECTORS.REQUEST_UNLOCK,
    [{ token: S_AVAX_ADDRESS, amount: sAvaxAmount }],
    deadline,
    adapterData,
    0n,
    executorAddr,
    `Request unlock of ${ethers.formatEther(sAvaxAmount)} sAVAX (~15 day cooldown)`
  );

  return {
    bundle: await builder.buildWithGas(`Request unlock ${ethers.formatEther(sAvaxAmount)} sAVAX`, req.userAddress),
    metadata: {
      action: "requestUnlock",
      sAvaxAmount: sAvaxAmount.toString(),
      estimatedAvax: sAvaxAmount.toString(), // approximation
      cooldownDays: 15,
    },
  };
}
