import { Request, Response, NextFunction } from "express";
import { ethers } from "ethers";
import { AppError } from "../shared/errorCodes";

const AUTH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Builds the canonical message the client must sign.
 * Must match exactly what the frontend signs.
 */
function buildAuthMessage(timestamp: number): string {
  return `PanoramaBlock auth: ${timestamp}`;
}

/**
 * Middleware: verifies that the caller owns the wallet address they claim.
 *
 * Expected request body fields (for POST) or query params (for GET):
 *   - userAddress: Ethereum address
 *   - signature:   ethers.signer.signMessage(buildAuthMessage(timestamp))
 *   - timestamp:   Unix ms timestamp used when signing (must be within 5 minutes)
 *
 * For GET history routes, these come as query params:
 *   GET /history/0xABC?signature=0x...&timestamp=1234567890
 *
 * On success, attaches req.verifiedAddress (checksummed) and calls next().
 */
export function requireWalletAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    const source = req.method === "GET" ? req.query : req.body;

    const rawAddress: string = (source.userAddress as string) ?? (req.params.userAddress as string);
    const signature: string  = source.signature  as string;
    const timestamp: number  = Number(source.timestamp);

    if (!rawAddress || !signature || !timestamp) {
      throw new AppError("INVALID_SIGNATURE", "userAddress, signature, and timestamp are required");
    }

    // Check timestamp freshness
    const now = Date.now();
    if (Math.abs(now - timestamp) > AUTH_WINDOW_MS) {
      throw new AppError("AUTH_EXPIRED");
    }

    // Recover signer from signature
    const message = buildAuthMessage(timestamp);
    const recovered = ethers.verifyMessage(message, signature);

    if (recovered.toLowerCase() !== rawAddress.toLowerCase()) {
      throw new AppError("INVALID_SIGNATURE", "Signature does not match provided address");
    }

    (req as any).verifiedAddress = ethers.getAddress(rawAddress);
    next();
  } catch (err) {
    next(err);
  }
}
