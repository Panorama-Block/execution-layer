import { Request, Response, NextFunction } from "express";

// ──────────────────────────────────────────────────────────────────
// EXECUTION TIMEOUT MIDDLEWARE
//
// Wraps any route handler with a hard deadline. If the handler doesn't
// send a response within the timeout, we send a 504 Gateway Timeout
// and prevent the handler from writing to the response afterwards.
//
// This prevents:
//   - Silent hangs when RPCs are congested and never respond
//   - Partial state from half-completed flows
//   - Frontend retries stacking up behind a stuck request
//
// Usage in routes:
//   router.post("/prepare", executionTimeout(15_000), asyncHandler(handler))
// ──────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Returns a middleware that enforces a response deadline.
 *
 * @param ms  Maximum time in milliseconds before 504 is sent.
 *            Defaults to 15 seconds.
 */
export function executionTimeout(ms: number = DEFAULT_TIMEOUT_MS) {
  return (req: Request, res: Response, next: NextFunction): void => {
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;

      // Only send 504 if the response hasn't started yet.
      // If headers are already sent, we can't change the status code.
      if (!res.headersSent) {
        console.error(
          `[timeout] ${req.method} ${req.path} exceeded ${ms}ms — sending 504`
        );
        res.status(504).json({
          error: {
            code: "EXECUTION_TIMEOUT",
            message: `Request timed out after ${ms / 1000}s. RPC nodes may be congested — please try again.`,
          },
        });
      }
    }, ms);

    // Clear the timer when the response finishes normally
    res.once("finish", () => clearTimeout(timer));
    res.once("close", () => clearTimeout(timer));

    // Patch res.json and res.send to no-op after timeout.
    // This prevents the late-arriving handler from crashing
    // with "Cannot set headers after they are sent to the client".
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.json = function guardedJson(body?: any) {
      if (timedOut) return res;
      return originalJson(body);
    } as any;

    res.send = function guardedSend(body?: any) {
      if (timedOut) return res;
      return originalSend(body);
    } as any;

    next();
  };
}
