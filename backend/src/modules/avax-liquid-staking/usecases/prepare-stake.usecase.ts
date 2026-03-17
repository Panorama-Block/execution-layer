import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { BundleBuilder, SAVAX_SELECTORS } from "../../../shared/bundle-builder";
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

export async function executePrepareStake(req: PrepareStakeRequest): Promise<PrepareStakeResponse> {
  const chain        = getChainConfig("avalanche");
  const executorAddr = chain.contracts.panoramaExecutor;
  if (!executorAddr) throw new AppError("INTERNAL_ERROR", "PanoramaExecutor not deployed on Avalanche");

  const amount = BigInt(req.amount);
  if (amount <= 0n) throw new AppError("INVALID_AMOUNT", "amount must be positive");

  const protocolId = encodeProtocolId("savax");
  const builder    = new BundleBuilder(chain.chainId);
  const deadline   = getDeadline(20);

  // stake(address recipient) — native AVAX sent as msg.value
  const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
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

  return {
    bundle: builder.build(`Stake ${ethers.formatEther(amount)} AVAX for sAVAX`),
    metadata: {
      action: "stake",
      avaxAmount: amount.toString(),
      estimatedSAvax: amount.toString(), // 1:1 approximation — actual rate varies
    },
  };
}
