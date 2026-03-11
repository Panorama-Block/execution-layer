export const ErrorCodes = {
  // Validation errors (400)
  INVALID_ADDRESS: { code: "INVALID_ADDRESS", status: 400, message: "Invalid Ethereum address format" },
  INVALID_AMOUNT: { code: "INVALID_AMOUNT", status: 400, message: "Invalid amount: must be a positive numeric string" },
  INVALID_TX_HASH: { code: "INVALID_TX_HASH", status: 400, message: "Invalid transaction hash format" },
  MISSING_FIELD: { code: "MISSING_FIELD", status: 400, message: "Missing required field" },
  INVALID_POOL_ID: { code: "INVALID_POOL_ID", status: 400, message: "Invalid or unknown pool ID" },
  INVALID_SLIPPAGE: { code: "INVALID_SLIPPAGE", status: 400, message: "Slippage must be between 1 and 5000 bps" },
  INVALID_SIGNATURE: { code: "INVALID_SIGNATURE", status: 401, message: "Invalid wallet signature" },
  AUTH_EXPIRED: { code: "AUTH_EXPIRED", status: 401, message: "Authentication payload has expired" },

  // Not found (404)
  POOL_NOT_FOUND: { code: "POOL_NOT_FOUND", status: 404, message: "Pool not found on-chain" },
  GAUGE_NOT_FOUND: { code: "GAUGE_NOT_FOUND", status: 404, message: "Gauge not found for pool" },
  TRANSACTION_NOT_FOUND: { code: "TRANSACTION_NOT_FOUND", status: 404, message: "Transaction not found" },
  ORDER_NOT_FOUND: { code: "ORDER_NOT_FOUND", status: 404, message: "DCA order not found" },

  // Rate limiting (429)
  RATE_LIMIT_EXCEEDED: { code: "RATE_LIMIT_EXCEEDED", status: 429, message: "Too many requests, please try again later" },

  // Server errors (500)
  INTERNAL_ERROR: { code: "INTERNAL_ERROR", status: 500, message: "Internal server error" },
  RPC_ERROR: { code: "RPC_ERROR", status: 502, message: "Blockchain RPC call failed" },
  PROVIDER_ERROR: { code: "PROVIDER_ERROR", status: 502, message: "External provider error" },
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: string;

  constructor(errorCode: ErrorCode, details?: string) {
    const def = ErrorCodes[errorCode];
    super(details ?? def.message);
    this.code = def.code;
    this.status = def.status;
    this.details = details;
  }
}
