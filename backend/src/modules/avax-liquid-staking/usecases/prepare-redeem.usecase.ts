import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { PANORAMA_LIQUID_STAKING_ABI } from "../../../utils/abi";
import { BundleBuilder } from "../../../shared/bundle-builder";
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

const LIQUID_STAKING_IFACE = new ethers.Interface(PANORAMA_LIQUID_STAKING_ABI);

export async function executePrepareRedeem(req: PrepareRedeemRequest): Promise<PrepareRedeemResponse> {
  const chain = getChainConfig("avalanche");
  const contractAddr = chain.contracts.panoramaLiquidStaking;
  if (!contractAddr) throw new AppError("INTERNAL_ERROR", "PanoramaLiquidStaking not deployed yet");

  if (req.userUnlockIndex < 0) throw new AppError("INVALID_AMOUNT", "userUnlockIndex must be >= 0");

  const builder = new BundleBuilder(chain.chainId);

  builder["steps"].push({
    to: contractAddr,
    data: LIQUID_STAKING_IFACE.encodeFunctionData("redeem", [req.userUnlockIndex]),
    value: "0",
    chainId: chain.chainId,
    description: `Redeem AVAX from unlock request #${req.userUnlockIndex}`,
  });

  return {
    bundle: builder.build(`Redeem AVAX from unlock request #${req.userUnlockIndex}`),
    metadata: {
      action: "redeem",
      userUnlockIndex: req.userUnlockIndex,
    },
  };
}
