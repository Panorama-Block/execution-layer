import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { PANORAMA_LIQUID_STAKING_ABI } from "../../../utils/abi";
import { BundleBuilder } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";

export interface PrepareStakeRequest {
  userAddress: string;
  amount: string; // AVAX amount in wei
}

export interface PrepareStakeResponse {
  bundle: TransactionBundle;
  metadata: {
    action: "stake";
    avaxAmount: string;
    estimatedSAvax: string;
  };
}

const LIQUID_STAKING_IFACE = new ethers.Interface(PANORAMA_LIQUID_STAKING_ABI);

export async function executePrepareStake(req: PrepareStakeRequest): Promise<PrepareStakeResponse> {
  const chain = getChainConfig("avalanche");
  const contractAddr = chain.contracts.panoramaLiquidStaking;
  if (!contractAddr) throw new AppError("INTERNAL_ERROR", "PanoramaLiquidStaking not deployed yet");

  const amount = BigInt(req.amount);
  if (amount <= 0n) throw new AppError("INVALID_AMOUNT", "amount must be positive");

  const builder = new BundleBuilder(chain.chainId);

  builder["steps"].push({
    to: contractAddr,
    data: LIQUID_STAKING_IFACE.encodeFunctionData("stake"),
    value: amount.toString(),
    chainId: chain.chainId,
    description: `Stake ${ethers.formatEther(amount)} AVAX → receive sAVAX via BENQI`,
  });

  return {
    bundle: builder.build(`Stake ${ethers.formatEther(amount)} AVAX for sAVAX`),
    metadata: {
      action: "stake",
      avaxAmount: amount.toString(),
      estimatedSAvax: amount.toString(), // 1:1 approximation — actual rate varies
    },
  };
}
