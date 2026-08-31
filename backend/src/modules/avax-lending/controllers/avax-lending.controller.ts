import { Request, Response } from "express";
import { asyncHandler }             from "../../../middleware/errorHandler";
import { executePrepareSupply }     from "../usecases/prepare-supply.usecase";
import { executePrepareRedeem }     from "../usecases/prepare-redeem.usecase";
import { executePrepareBorrow }     from "../usecases/prepare-borrow.usecase";
import { executePrepareRepay }      from "../usecases/prepare-repay.usecase";
import { getEnabledMarkets }        from "../config/avax-lending-markets";
import { avaxService }              from "../../../shared/services/avax.service";
import { getContract }              from "../../../providers/chain.provider";
import { BENQI_TOKEN_ABI }         from "../../../utils/abi";
import {
  submitAndVerifyEvidence,
  verifyEvidenceStep,
  recordEvidenceExecutionOutcome
} from "../../../shared/services/transaction-evidence.service";
import { AppError } from "../../../shared/errorCodes";

export const getMarkets = asyncHandler(async (_req: Request, res: Response) => {
  const markets = getEnabledMarkets();

  const marketsWithRates = await Promise.all(
    markets.map(async (m) => {
      const [supplyRate, borrowRate] = await Promise.all([
        avaxService.getSupplyRate(m.qTokenAddress),
        avaxService.getBorrowRate(m.qTokenAddress),
      ]);
      return { ...m, supplyRatePerTimestamp: supplyRate.toString(), borrowRatePerTimestamp: borrowRate.toString() };
    })
  );

  res.json({ markets: marketsWithRates });
});

export const getUserPosition = asyncHandler(async (req: Request, res: Response) => {
  const { userAddress } = req.params;
  const markets = getEnabledMarkets();

  const positions = await Promise.all(
    markets.map(async (m) => {
      const qToken = getContract(m.qTokenAddress, BENQI_TOKEN_ABI, "avalanche");
      const [qTokenBalance, exchangeRate, borrowBalance] = await Promise.all([
        qToken.balanceOf(userAddress) as Promise<bigint>,
        qToken.exchangeRateStored() as Promise<bigint>,
        qToken.borrowBalanceStored(userAddress) as Promise<bigint>,
      ]);
      // suppliedWei = qTokenBalance × exchangeRate / 1e18  (Compound-fork formula)
      const suppliedWei = (qTokenBalance * exchangeRate) / BigInt(1e18);
      return {
        ...m,
        qTokenBalance: qTokenBalance.toString(),
        suppliedWei: suppliedWei.toString(),
        borrowedWei: borrowBalance.toString(),
      };
    })
  );

  const active = positions.filter(p => BigInt(p.qTokenBalance) > 0n || BigInt(p.borrowedWei) > 0n);
  res.json({ userAddress, positions: active });
});

export const prepareSupply = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareSupply({
    userAddress:   req.body.userAddress,
    qTokenAddress: req.body.qTokenAddress,
    amount:        req.body.amount,
  });
  res.json(result);
});

export const submitEvidence = asyncHandler(async (req: Request, res: Response) => {
  const { correlationId } = req.params;
  const {
    stepIndex,
    txHash,
    executionMechanism,
    providerMetadata,
  } = req.body;

  if (!correlationId || typeof correlationId !== "string") {
    throw new AppError(
      "MISSING_FIELD",
      "correlationId is required"
    );
  }

  if (!Number.isInteger(stepIndex) || stepIndex < 0) {
    throw new AppError(
      "MISSING_FIELD",
      "stepIndex must be a non-negative integer"
    );
  }

  if (
    typeof txHash !== "string" ||
    !/^0x[a-fA-F0-9]{64}$/.test(txHash)
  ) {
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
      err instanceof Error
        ? err.message
        : "Evidence verification failed";

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
});



export const recordEvidenceOutcome = asyncHandler(
  async (req: Request, res: Response) => {
    const { correlationId } = req.params;
    const { outcome, reason } = req.body;

    if (
      !correlationId ||
      typeof correlationId !== "string"
    ) {
      throw new AppError(
        "MISSING_FIELD",
        "correlationId is required"
      );
    }

    if (
      outcome !== "cancelled-before-submission" &&
      outcome !== "partially-executed"
    ) {
      throw new AppError(
        "UNSUPPORTED_OPERATION",
        "Unsupported evidence execution outcome"
      );
    }

    try {
      const result =
        await recordEvidenceExecutionOutcome({
          correlationId,
          outcome,
          reason:
            typeof reason === "string"
              ? reason
              : undefined,
        });

      res.json(result);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const message =
        error instanceof Error
          ? error.message
          : "Evidence outcome reporting failed";

      if (message.includes("not found")) {
        throw new AppError(
          "TRANSACTION_NOT_FOUND",
          message
        );
      }

      if (
        message.includes("Cannot record") ||
        message.includes(
          "at least one but not all"
        )
      ) {
        throw new AppError(
          "UNSUPPORTED_OPERATION",
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

export const verifyEvidence = asyncHandler(
  async (req: Request, res: Response) => {
    const { correlationId } = req.params;
    const { stepIndex } = req.body;

    if (
      !correlationId ||
      typeof correlationId !== "string"
    ) {
      throw new AppError(
        "MISSING_FIELD",
        "correlationId is required"
      );
    }

    if (
      !Number.isInteger(stepIndex) ||
      stepIndex < 0
    ) {
      throw new AppError(
        "MISSING_FIELD",
        "stepIndex must be a non-negative integer"
      );
    }

    try {
      const result =
        await verifyEvidenceStep({
          correlationId,
          stepIndex,
        });

      res.json(result);
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }

      const message =
        err instanceof Error
          ? err.message
          : "Evidence verification failed";

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


export const prepareRedeem = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareRedeem({
    userAddress:   req.body.userAddress,
    qTokenAddress: req.body.qTokenAddress,
    amount:        req.body.amount,
  });
  res.json(result);
});

export const prepareBorrow = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareBorrow({
    userAddress:   req.body.userAddress,
    qTokenAddress: req.body.qTokenAddress,
    amount:        req.body.amount,
  });
  res.json(result);
});

export const prepareRepay = asyncHandler(async (req: Request, res: Response) => {
  const result = await executePrepareRepay({
    userAddress:   req.body.userAddress,
    qTokenAddress: req.body.qTokenAddress,
    amount:        req.body.amount,
  });
  res.json(result);
});
