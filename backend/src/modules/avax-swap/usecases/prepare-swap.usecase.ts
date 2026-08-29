import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { avaxService, WAVAX } from "../../../shared/services/avax.service";
import { applySlippage, getDeadline, encodeProtocolId } from "../../../utils/encoding";
import { BundleBuilder, TRADERJOE_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { logger } from "../../../shared/logger";
import {
  prepareEvidenceBoundBundle,
} from "../../../shared/services/evidence-bound-preparation.service";

export interface PrepareAvaxSwapRequest {
  userAddress:     string;
  tokenIn:         string;
  tokenOut:        string;
  amountIn:        string;   // in wei / base units
  slippageBps?:    number;
  deadlineMinutes?: number;
}

export interface PrepareAvaxSwapResponse {
  correlationId: string;
  evidenceVersion: string;
  evidenceEnabled: boolean;
  preparedPayloadHash: string;
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
const WAVAX_LOWER  = WAVAX.toLowerCase();

// ABI mínimo para wrap (deposit) e unwrap (withdraw)
const WAVAX_WRAP_ABI   = ["function deposit() external payable"];
const WAVAX_UNWRAP_ABI = ["function withdraw(uint256 wad) external"];

export async function executePrepareAvaxSwap(
  req: PrepareAvaxSwapRequest
): Promise<PrepareAvaxSwapResponse> {
  logger.info({ chain: "avalanche", protocol: "traderjoe", user: req.userAddress, tokenIn: req.tokenIn, tokenOut: req.tokenOut, amountIn: req.amountIn, slippageBps: req.slippageBps }, "Prepare swap request");

  const chain        = getChainConfig("avalanche");
  const executorAddr = chain.contracts.panoramaExecutor;
  logger.info({ chain: "avalanche", executor: executorAddr }, "Executor address resolved");
  if (!executorAddr) throw new AppError("INTERNAL_ERROR", "PanoramaExecutor not deployed on Avalanche");

  const amountIn     = BigInt(req.amountIn);
  const slippageBps  = req.slippageBps   ?? 50;
  const deadlineMins = req.deadlineMinutes ?? 20;

  if (amountIn <= 0n) throw new AppError("INVALID_AMOUNT", "amountIn must be positive");

  const tokenInLower  = req.tokenIn.toLowerCase();
  const tokenOutLower = req.tokenOut.toLowerCase();

  return prepareEvidenceBoundBundle({
    intent: {
      action: "swap",
      chainId: chain.chainId,
      network: "avalanche-c-chain",
      walletAddress: req.userAddress,
      assetIn: req.tokenIn,
      assetOut: req.tokenOut,
      amountRaw: amountIn.toString(),
      slippageBps,
    },
    prepare: async () => {

  // ── Wrap: AVAX → WAVAX ──────────────────────────────────────────────
  if (tokenInLower === WAVAX_LOWER && tokenOutLower === WAVAX_LOWER) {
    const iface = new ethers.Interface(WAVAX_WRAP_ABI);
    const bundle: TransactionBundle = {
      steps: [{
        to: WAVAX, data: iface.encodeFunctionData("deposit", []),
        value: amountIn.toString(), chainId: chain.chainId,
        description: "Wrap AVAX → WAVAX",
      }],
      totalSteps: 1,
      summary: "Wrap AVAX → WAVAX",
    };

    const metadata = {
      tokenIn: req.tokenIn,
      tokenOut: req.tokenOut,
      amountIn: amountIn.toString(),
      amountOut: amountIn.toString(),
      amountOutMin: amountIn.toString(),
      path: [WAVAX],
      swapType: "wrap",
      slippageBps,
      priceImpact: "0",
    };

    return {
      bundle,
      metadata,
    };
  }

  // ── Unwrap: WAVAX → AVAX ────────────────────────────────────────────
  // tokenIn = WAVAX, tokenOut = zero/native (handled by frontend as WAVAX too,
  // but kept here for completeness if called directly)
  // (Covered by swap path if they differ — left for future use)

  const { amountOut, path } = await avaxService.getQuoteWithHop(req.tokenIn, req.tokenOut, amountIn);
  const amountOutMin        = applySlippage(amountOut, slippageBps);
  const deadline            = getDeadline(deadlineMins);

  const isAvaxIn  = req.tokenIn.toLowerCase()  === WAVAX.toLowerCase();
  const isAvaxOut = req.tokenOut.toLowerCase() === WAVAX.toLowerCase();
  const swapType  = isAvaxIn ? "avax-to-token" : isAvaxOut ? "token-to-avax" : "token-to-token";

  logger.info({ chain: "avalanche", protocol: "traderjoe", path, amountIn: amountIn.toString(), amountOut: amountOut.toString(), amountOutMin: amountOutMin.toString(), swapType, isAvaxIn, isAvaxOut, deadline }, "Swap quote obtained");

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

  logger.info({ chain: "avalanche", protocol: "traderjoe", selector: TRADERJOE_SELECTORS.SWAP_WITH_PATH, protocolId, transfers: transfers.map(t => ({ token: t.token, amount: t.amount.toString() })), ethValue: ethValue.toString() }, "Adapter data encoded");

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

  const bundle = await builder.buildWithGas(`Swap ${swapType} via TraderJoe on Avalanche`, req.userAddress);
  logger.info({ chain: "avalanche", protocol: "traderjoe", steps: bundle.steps.map(s => ({ to: s.to, value: s.value, dataLen: s.data.length, description: s.description })) }, "Bundle built");

  const priceImpact = amountIn > 0n
    ? (100 - (Number(amountOut) / Number(amountIn)) * 100).toFixed(4)
    : "0";

  const metadata = {
    tokenIn:      req.tokenIn,
    tokenOut:     req.tokenOut,
    amountIn:     amountIn.toString(),
    amountOut:    amountOut.toString(),
    amountOutMin: amountOutMin.toString(),
    path,
    swapType,
    slippageBps,
    priceImpact,
  };

  return {
    bundle,
    metadata,
  };
    },
  });
}
