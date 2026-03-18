import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { avaxService, WAVAX } from "../../../shared/services/avax.service";
import { applySlippage, getDeadline, encodeProtocolId } from "../../../utils/encoding";
import { BundleBuilder, TRADERJOE_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";

export interface PrepareAvaxSwapRequest {
  userAddress:     string;
  tokenIn:         string;
  tokenOut:        string;
  amountIn:        string;   // in wei / base units
  slippageBps?:    number;
  deadlineMinutes?: number;
}

export interface PrepareAvaxSwapResponse {
  bundle:   TransactionBundle;
  metadata: {
    tokenIn:      string;
    tokenOut:     string;
    amountIn:     string;
    amountOut:    string;
    amountOutMin: string;
    path:         string[];
    swapType:     string;
    slippageBps:  number;
    priceImpact:  string;
  };
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export async function executePrepareAvaxSwap(
  req: PrepareAvaxSwapRequest
): Promise<PrepareAvaxSwapResponse> {
  const chain        = getChainConfig("avalanche");
  const executorAddr = chain.contracts.panoramaExecutor;
  if (!executorAddr) throw new AppError("INTERNAL_ERROR", "PanoramaExecutor not deployed on Avalanche");

  const amountIn      = BigInt(req.amountIn);
  const slippageBps   = req.slippageBps   ?? 50;
  const deadlineMins  = req.deadlineMinutes ?? 20;

  if (amountIn <= 0n) throw new AppError("INVALID_AMOUNT", "amountIn must be positive");

  const { amountOut, path } = await avaxService.getQuoteWithHop(req.tokenIn, req.tokenOut, amountIn);
  const amountOutMin        = applySlippage(amountOut, slippageBps);
  const deadline            = getDeadline(deadlineMins);

  const isAvaxIn  = req.tokenIn.toLowerCase()  === WAVAX.toLowerCase();
  const isAvaxOut = req.tokenOut.toLowerCase() === WAVAX.toLowerCase();
  const swapType  = isAvaxIn ? "avax-to-token" : isAvaxOut ? "token-to-avax" : "token-to-token";

  const protocolId = encodeProtocolId("traderjoe");
  const builder    = new BundleBuilder(chain.chainId);

  // Transfers: executor pulls ERC-20 from user → proxy
  const transfers: Array<{ token: string; amount: bigint }> = [];
  let ethValue = 0n;

  if (isAvaxIn) {
    // Native AVAX — sent as msg.value, no ERC-20 transfer
    ethValue = amountIn;
  } else {
    // ERC-20 — approve executor, then executor transfers to proxy
    const allowance = await avaxService.checkAllowance(req.tokenIn, req.userAddress, executorAddr, amountIn);
    builder.addApproveIfNeeded(
      req.tokenIn,
      executorAddr,
      allowance,
      amountIn,
      `Approve tokenIn for PanoramaExecutor`
    );
    transfers.push({ token: req.tokenIn, amount: amountIn });
  }

  // Adapter data — params of swapWithPath(uint256,uint256,address[],address) without selector
  const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint256", "address[]", "address"],
    [amountIn, amountOutMin, path, req.userAddress]
  );

  builder.addExecute(
    protocolId,
    TRADERJOE_SELECTORS.SWAP_WITH_PATH,
    transfers,
    deadline,
    adapterData,
    ethValue,
    executorAddr,
    `Swap via TraderJoe (${swapType})`
  );

  const priceImpact = amountIn > 0n
    ? (100 - (Number(amountOut) / Number(amountIn)) * 100).toFixed(4)
    : "0";

  return {
    bundle: builder.build(`Swap ${swapType} via TraderJoe on Avalanche`),
    metadata: {
      tokenIn:      req.tokenIn,
      tokenOut:     req.tokenOut,
      amountIn:     amountIn.toString(),
      amountOut:    amountOut.toString(),
      amountOutMin: amountOutMin.toString(),
      path,
      swapType,
      slippageBps,
      priceImpact,
    },
  };
}
