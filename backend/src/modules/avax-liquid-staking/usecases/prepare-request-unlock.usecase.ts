import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { PANORAMA_LIQUID_STAKING_ABI } from "../../../utils/abi";
import { avaxService } from "../../../shared/services/avax.service";
import { BundleBuilder } from "../../../shared/bundle-builder";
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

const LIQUID_STAKING_IFACE = new ethers.Interface(PANORAMA_LIQUID_STAKING_ABI);

const S_AVAX_ADDRESS = "0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE";

export async function executePrepareRequestUnlock(req: PrepareRequestUnlockRequest): Promise<PrepareRequestUnlockResponse> {
  const chain = getChainConfig("avalanche");
  const contractAddr = chain.contracts.panoramaLiquidStaking;
  if (!contractAddr) throw new AppError("INTERNAL_ERROR", "PanoramaLiquidStaking not deployed yet");

  const sAvaxAmount = BigInt(req.sAvaxAmount);
  if (sAvaxAmount <= 0n) throw new AppError("INVALID_AMOUNT", "sAvaxAmount must be positive");

  const builder = new BundleBuilder(chain.chainId);

  // Step 1: approve sAVAX → PanoramaLiquidStaking
  const allowance = await avaxService.checkAllowance(S_AVAX_ADDRESS, req.userAddress, contractAddr, sAvaxAmount);
  builder.addApproveIfNeeded(
    S_AVAX_ADDRESS,
    contractAddr,
    allowance,
    sAvaxAmount,
    "Approve sAVAX for PanoramaLiquidStaking"
  );

  // Step 2: requestUnlock
  builder["steps"].push({
    to: contractAddr,
    data: LIQUID_STAKING_IFACE.encodeFunctionData("requestUnlock", [sAvaxAmount]),
    value: "0",
    chainId: chain.chainId,
    description: `Request unlock of ${ethers.formatEther(sAvaxAmount)} sAVAX (~15 day cooldown)`,
  });

  return {
    bundle: builder.build(`Request unlock ${ethers.formatEther(sAvaxAmount)} sAVAX`),
    metadata: {
      action: "requestUnlock",
      sAvaxAmount: sAvaxAmount.toString(),
      estimatedAvax: sAvaxAmount.toString(), // approximation
      cooldownDays: 15,
    },
  };
}
