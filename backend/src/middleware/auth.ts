import { Request, Response, NextFunction } from "express";
import { ethers } from "ethers";
import { AppError } from "../shared/errorCodes";
import { TxModule } from "../shared/transactionStore";

const AUTH_WINDOW_MS = 5 * 60 * 1000;

function parseTimestamp(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AppError("MISSING_FIELD", "Missing or invalid timestamp");
  }
  return parsed;
}

function validateFreshTimestamp(timestamp: number) {
  if (Math.abs(Date.now() - timestamp) > AUTH_WINDOW_MS) {
    throw new AppError("AUTH_EXPIRED");
  }
}

function recoverSigner(message: string, signature: unknown): string {
  if (typeof signature !== "string" || signature.length === 0) {
    throw new AppError("MISSING_FIELD", "Missing required field: signature");
  }
  try {
    return ethers.verifyMessage(message, signature);
  } catch {
    throw new AppError("INVALID_SIGNATURE");
  }
}

function assertUserSignature(expectedUser: string, signer: string) {
  if (signer.toLowerCase() !== expectedUser.toLowerCase()) {
    throw new AppError("INVALID_SIGNATURE");
  }
}

function buildTxSubmitMessage(module: TxModule, userAddress: string, txHash: string, action: string, timestamp: number): string {
  return [
    "PanoramaBlock transaction submission",
    `module:${module}`,
    `user:${userAddress.toLowerCase()}`,
    `txHash:${txHash.toLowerCase()}`,
    `action:${action}`,
    `timestamp:${timestamp}`,
  ].join("\n");
}

function buildHistoryMessage(module: TxModule, userAddress: string, timestamp: number): string {
  return [
    "PanoramaBlock history access",
    `module:${module}`,
    `user:${userAddress.toLowerCase()}`,
    `timestamp:${timestamp}`,
  ].join("\n");
}

export function requireSignedTxSubmission(module: TxModule) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const { userAddress, txHash, action, timestamp, signature } = req.body;
      if (typeof userAddress !== "string" || typeof txHash !== "string") {
        throw new AppError("MISSING_FIELD", "Missing required fields: userAddress, txHash");
      }

      const ts = parseTimestamp(timestamp);
      validateFreshTimestamp(ts);
      const message = buildTxSubmitMessage(module, userAddress, txHash, String(action ?? module), ts);
      const signer = recoverSigner(message, signature);
      assertUserSignature(userAddress, signer);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireSignedHistoryAccess(module: TxModule) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const userAddress = String(req.params.userAddress ?? "");
      const timestamp = parseTimestamp(req.query.timestamp);
      validateFreshTimestamp(timestamp);
      const message = buildHistoryMessage(module, userAddress, timestamp);
      const signer = recoverSigner(message, req.query.signature);
      assertUserSignature(userAddress, signer);
      next();
    } catch (err) {
      next(err);
    }
  };
}
