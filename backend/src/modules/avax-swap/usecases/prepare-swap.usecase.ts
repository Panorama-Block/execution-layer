import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { avaxService, WAVAX } from "../../../shared/services/avax.service";
import { applySlippage, getDeadline } from "../../../utils/encoding";
import { PANORAMA_SWAP_ABI, ERC20_ABI } from "../../../utils/abi";
import { BundleBuilder } from "../../../shared/bundle-builder";
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

const PANORAMA_SWAP_IFACE = new ethers.Interface(PANORAMA_SWAP_ABI);
const ERC20_IFACE         = new ethers.Interface([
  "function approve(address spender, uint256 amount) external returns (bool)",
]);

export async function executePrepareAvaxSwap(
  req: PrepareAvaxSwapRequest
): Promise<PrepareAvaxSwapResponse> {
  const chain     = getChainConfig("avalanche");
  const swapAddr  = chain.contracts.panoramaSwap;
  if (!swapAddr) throw new AppError("INTERNAL_ERROR", "PanoramaSwap not deployed yet");

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

  const builder = new BundleBuilder(chain.chainId);

  if (!isAvaxIn) {
    // Check and add approval for tokenIn → PanoramaSwap
    const allowance = await avaxService.checkAllowance(req.tokenIn, req.userAddress, swapAddr, amountIn);
    builder.addApproveIfNeeded(
      req.tokenIn,
      swapAddr,
      allowance,
      amountIn,
      `Approve tokenIn for PanoramaSwap`
    );
  }

  // Build swap calldata
  let swapData: string;
  let ethValue = 0n;

  if (isAvaxIn) {
    swapData = PANORAMA_SWAP_IFACE.encodeFunctionData("swapAVAXForTokens", [
      amountOutMin, path, deadline,
    ]);
    ethValue = amountIn;
  } else if (isAvaxOut) {
    swapData = PANORAMA_SWAP_IFACE.encodeFunctionData("swapTokensForAVAX", [
      amountIn, amountOutMin, path, deadline,
    ]);
  } else {
    swapData = PANORAMA_SWAP_IFACE.encodeFunctionData("swapTokensForTokens", [
      amountIn, amountOutMin, path, deadline,
    ]);
  }

  builder["steps"].push({
    to:          swapAddr,
    data:        swapData,
    value:       ethValue.toString(),
    chainId:     chain.chainId,
    description: `Swap via PanoramaSwap (${swapType})`,
  });

  const priceImpact = amountIn > 0n
    ? (100 - (Number(amountOut) / Number(amountIn)) * 100).toFixed(4)
    : "0";

  return {
    bundle: builder.build(`Swap ${swapType} via PanoramaSwap on Avalanche`),
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
