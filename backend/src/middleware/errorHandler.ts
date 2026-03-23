import { Request, Response, NextFunction, RequestHandler } from "express";
import { AppError } from "../shared/errorCodes";

const RPC_ERROR_PATTERNS = [
  /timeout/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /missing response/i,
  /could not detect network/i,
  /bad response/i,
  /server error/i,
  /rate.?limit/i,
  /too many requests/i,
  /circuit breaker/i,
  /NETWORK_ERROR/i,
  /SERVER_ERROR/i,
  /TIMEOUT/i,
];

function isRpcError(err: Error): boolean {
  const msg = err.message || "";
  return RPC_ERROR_PATTERNS.some((pattern) => pattern.test(msg));
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    const headers: Record<string, string> = {};
    if (err.status === 503) headers["Retry-After"] = "5";
    return res.status(err.status).set(headers).json({
      error: {
        code: err.code,
        message: err.details ?? err.message,
        ...(err.status === 503 ? { retryAfter: 5 } : {}),
      },
    });
  }

  // Detect RPC/provider failures and return 503 instead of 500
  if (isRpcError(err)) {
    console.error("[RPC_UNAVAILABLE]", err.message);
    return res.status(503).set({ "Retry-After": "5" }).json({
      error: {
        code: "RPC_UNAVAILABLE",
        message: "Blockchain node temporarily unavailable. Please retry.",
        retryAfter: 5,
      },
    });
  }

  console.error("Unhandled error:", err);
  return res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    },
  });
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
