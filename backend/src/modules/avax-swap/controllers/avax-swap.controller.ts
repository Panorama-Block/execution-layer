import { Request, Response } from "express";
import { asyncHandler } from "../../../middleware/errorHandler";
import { executeGetAvaxQuote }    from "../usecases/get-quote.usecase";
import { executePrepareAvaxSwap } from "../usecases/prepare-swap.usecase";
import { getEnabledSwapPairs }    from "../config/avax-swap-pairs";
import {
  submitAndVerifyEvidence,
  getTransactionEvidence,
  exportTransactionEvidence,
  exportTransactionEvidenceByWallet,
  exportTransactionEvidenceAdmin,
  isPhase2EvidenceAdmin,
} from "../../../shared/services/transaction-evidence.service";
import { AppError } from "../../../shared/errorCodes";

export const getQuote = asyncHandler(async (req: Request, res: Response) => {
  const result = await executeGetAvaxQuote({
    tokenIn:    req.body.tokenIn,
    tokenOut:   req.body.tokenOut,
    amountIn:   req.body.amountIn,
    slippageBps: req.body.slippageBps,
  });
  res.json(result);
});

export const prepareSwap = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareAvaxSwap({
    userAddress:     req.body.userAddress,
    tokenIn:         req.body.tokenIn,
    tokenOut:        req.body.tokenOut,
    amountIn:        req.body.amountIn,
    slippageBps:     req.body.slippageBps,
    deadlineMinutes: req.body.deadlineMinutes,
  });
  res.json(result);
});

export const getPairs = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ pairs: getEnabledSwapPairs() });
});

export const submitEvidence = asyncHandler(async (req: Request, res: Response) => {
  const { correlationId } = req.params;
  const { stepIndex, txHash, executionMechanism, providerMetadata } = req.body;

  if (!correlationId || typeof correlationId !== "string") {
    throw new AppError("MISSING_FIELD", "correlationId is required");
  }

  if (!Number.isInteger(stepIndex) || stepIndex < 0) {
    throw new AppError("MISSING_FIELD", "stepIndex must be a non-negative integer");
  }

  if (typeof txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    throw new AppError("INVALID_TX_HASH");
  }

  try {
    const result = await submitAndVerifyEvidence({
      correlationId,
      stepIndex,
      txHash,
      executionMechanism,
      providerMetadata,
      chain: "avalanche",
    });

    res.json(result);
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }

    const message =
      err instanceof Error ? err.message : "Evidence verification failed";

    if (message.includes("not found")) {
      throw new AppError("TRANSACTION_NOT_FOUND", message);
    }

    throw new AppError("INTERNAL_ERROR", message);
  }
});

export const getEvidence = asyncHandler(
  async (req: Request, res: Response) => {
    const { correlationId } = req.params;

    if (!correlationId || typeof correlationId !== "string") {
      throw new AppError(
        "MISSING_FIELD",
        "correlationId is required"
      );
    }

    try {
      const evidence =
        await getTransactionEvidence(correlationId);

      res.json(evidence);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Evidence retrieval failed";

      if (message.includes("not found")) {
        throw new AppError(
          "TRANSACTION_NOT_FOUND",
          message
        );
      }

      throw new AppError(
        "INTERNAL_ERROR",
        message
      );
    }
  }
);

export const exportEvidence = asyncHandler(
  async (req: Request, res: Response) => {
    const { correlationId } = req.params;

    if (!correlationId || typeof correlationId !== "string") {
      throw new AppError(
        "MISSING_FIELD",
        "correlationId is required"
      );
    }

    try {
      const evidenceExport =
        await exportTransactionEvidence(
          correlationId
        );

      res.setHeader(
        "Content-Type",
        "application/json"
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="panoramablock-evidence-${correlationId}.json"`
      );

      res.json(evidenceExport);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Evidence export failed";

      if (message.includes("not found")) {
        throw new AppError(
          "TRANSACTION_NOT_FOUND",
          message
        );
      }

      throw new AppError(
        "INTERNAL_ERROR",
        message
      );
    }
  }
);


export const exportEvidenceByWallet = asyncHandler(
  async (req: Request, res: Response) => {
    const verifiedAddress =
      (req as any).verifiedAddress as string;

    try {
      const evidenceExport =
        await exportTransactionEvidenceByWallet(
          verifiedAddress,
          43114
        );

      res.setHeader(
        "Content-Type",
        "application/json"
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="panoramablock-avalanche-evidence-${verifiedAddress.toLowerCase()}.json"`
      );

      res.json(evidenceExport);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Bulk evidence export failed";

      throw new AppError(
        "INTERNAL_ERROR",
        message
      );
    }
  }
);


export const getEvidenceAdminStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const verifiedAddress =
      (req as any).verifiedAddress as string;

    res.json({
      isAdmin: isPhase2EvidenceAdmin(verifiedAddress),
    });
  }
);


export const exportEvidenceAdmin = asyncHandler(
  async (req: Request, res: Response) => {
    const verifiedAddress =
      (req as any).verifiedAddress as string;

    if (!isPhase2EvidenceAdmin(verifiedAddress)) {
      throw new AppError("PHASE2_ADMIN_FORBIDDEN");
    }

    try {
      const evidenceExport =
        await exportTransactionEvidenceAdmin(43114);

      res.setHeader(
        "Content-Type",
        "application/json"
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="panoramablock-avalanche-admin-evidence.json"`
      );

      res.json(evidenceExport);
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }

      const message =
        err instanceof Error
          ? err.message
          : "Administrative evidence export failed";

      throw new AppError(
        "INTERNAL_ERROR",
        message
      );
    }
  }
);
