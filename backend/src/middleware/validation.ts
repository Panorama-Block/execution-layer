import { Request, Response, NextFunction } from "express";
import { ethers } from "ethers";
import { AppError } from "../shared/errorCodes";

export function validateAddress(field: string, source: "body" | "params" | "query" = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const value = req[source][field];
    if (!value) {
      return next(new AppError("MISSING_FIELD", `Missing required field: ${field}`));
    }
    if (!ethers.isAddress(value)) {
      return next(new AppError("INVALID_ADDRESS", `Invalid address for field: ${field}`));
    }
    next();
  };
}

export function validateAmount(field: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const value = req.body[field];
    if (!value) {
      return next(new AppError("MISSING_FIELD", `Missing required field: ${field}`));
    }
    try {
      const n = BigInt(value);
      if (n <= 0n) {
        return next(new AppError("INVALID_AMOUNT", `${field} must be positive`));
      }
    } catch {
      return next(new AppError("INVALID_AMOUNT", `${field} is not a valid numeric string`));
    }
    next();
  };
}

export function validateTxHash(field: string, source: "body" | "params" = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const value = req[source][field];
    if (!value) {
      return next(new AppError("MISSING_FIELD", `Missing required field: ${field}`));
    }
    if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
      return next(new AppError("INVALID_TX_HASH", `Invalid transaction hash: ${field}`));
    }
    next();
  };
}

export function validateRequired(...fields: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    for (const field of fields) {
      if (req.body[field] === undefined || req.body[field] === null || req.body[field] === "") {
        return next(new AppError("MISSING_FIELD", `Missing required field: ${field}`));
      }
    }
    next();
  };
}

export function validateSlippage() {
  return (req: Request, _res: Response, next: NextFunction) => {
    const { slippageBps } = req.body;
    if (slippageBps !== undefined) {
      const n = Number(slippageBps);
      if (isNaN(n) || n < 1 || n > 5000) {
        return next(new AppError("INVALID_SLIPPAGE"));
      }
    }
    next();
  };
}
