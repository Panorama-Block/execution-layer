import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { traceStore, logger } from "../shared/logger";

// Extend Express Request so any handler can read req.traceId
declare global {
  namespace Express {
    interface Request {
      traceId: string;
    }
  }
}

/**
 * Injects a unique traceId per request and logs method + path.
 * The traceId is propagated via AsyncLocalStorage so every logger
 * call within the request automatically includes it.
 */
export function tracingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceId = (req.headers["x-trace-id"] as string) || randomUUID();
  req.traceId = traceId;
  res.setHeader("x-trace-id", traceId);

  const start = Date.now();

  res.on("finish", () => {
    logger.info(
      {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - start,
      },
      `${req.method} ${req.path} ${res.statusCode}`,
    );
  });

  traceStore.run({ traceId }, () => next());
}
