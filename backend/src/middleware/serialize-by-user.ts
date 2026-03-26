import { Request, Response, NextFunction } from "express";

// ──────────────────────────────────────────────────────────────────
// CONSTANTS
// ──────────────────────────────────────────────────────────────────

/** How long a queued request waits before being force-released (prevents deadlocks). */
const QUEUE_TIMEOUT_MS = 30_000;

/** Max concurrent queued requests per user. Beyond this, new requests are rejected with 429. */
const MAX_QUEUE_SIZE = 10;

// ──────────────────────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────────────────────

/** Maps userKey → the tail of the serialization chain (a resolved promise = idle). */
const locks = new Map<string, Promise<void>>();

/** Tracks how many requests are currently queued per user. */
const queueDepth = new Map<string, number>();

// ──────────────────────────────────────────────────────────────────
// USER IDENTIFICATION
// Extracts the wallet address from the request to use as serialization key.
// Checks multiple sources in priority order:
//   1. req.verifiedAddress — set by auth middleware (most trusted)
//   2. req.body.userAddress — from POST body
//   3. req.query.userAddress — from query string
//   4. req.params.userAddress — from URL params
// Returns null if no user can be identified (health checks, public routes).
// ──────────────────────────────────────────────────────────────────
function getUserKey(req: Request): string | null {
  const addr =
    (req as any).verifiedAddress ||
    req.body?.userAddress ||
    (req.query?.userAddress as string) ||
    req.params?.userAddress;

  return addr ? String(addr).toLowerCase() : null;
}

// ──────────────────────────────────────────────────────────────────
// MIDDLEWARE
//
// Ensures that concurrent state-changing requests from the same
// wallet address are processed one at a time. This prevents:
//   - RPC call bursts that overwhelm free RPC endpoints
//   - Race conditions in adapter state (e.g. nonce conflicts)
//   - Double-execution of the same transaction bundle
//
// Requests are chained via Promises: each new request waits for
// the previous one from the same user to complete before proceeding.
// ──────────────────────────────────────────────────────────────────
export function serializeByUser(req: Request, res: Response, next: NextFunction): void {
  // ── Bypass 1: Idempotent methods ──
  // GET/HEAD/OPTIONS are read-only. They must NOT block writes,
  // and writes must NOT block reads. Skip serialization entirely.
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }

  // ── Bypass 2: prepare-* routes ──
  // These POSTs are idempotent read-only queries that build unsigned
  // transaction bundles. The frontend fires multiple prewarm POSTs
  // on amount change; serializing them causes the user's final request
  // to queue behind all prewarms, compounding latency past 30s timeout.
  if (req.path.includes("/prepare-")) {
    next();
    return;
  }

  // ── No user identified → pass through ──
  const userKey = getUserKey(req);
  if (!userKey) {
    next();
    return;
  }

  // ── Queue overflow protection ──
  // If a user already has MAX_QUEUE_SIZE requests queued, reject
  // immediately instead of letting the queue grow unbounded.
  const currentDepth = queueDepth.get(userKey) ?? 0;
  if (currentDepth >= MAX_QUEUE_SIZE) {
    console.warn(`[serialize] rejecting request for ${userKey.slice(0, 10)}… — queue full (${currentDepth})`);
    res.status(429).json({
      error: {
        code: "QUEUE_FULL",
        message: "Too many pending requests. Please wait for current operations to complete.",
      },
    });
    return;
  }

  // ── Chain this request after the previous one ──
  const prev = locks.get(userKey) ?? Promise.resolve();
  queueDepth.set(userKey, currentDepth + 1);

  // Create a deferred promise that we resolve when this request finishes.
  // The NEXT request from this user will await this promise.
  let releaseLock: () => void;
  const currentLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  locks.set(userKey, currentLock);

  // ── Deadlock prevention ──
  // If a request handler never sends a response (hangs), the timeout
  // force-releases the lock so subsequent requests aren't stuck forever.
  const timeout = setTimeout(() => {
    releaseLock!();
  }, QUEUE_TIMEOUT_MS);

  // ── Release on response completion ──
  // "finish" fires when the response is fully sent.
  // "close" fires if the client disconnects prematurely.
  const release = () => {
    clearTimeout(timeout);
    releaseLock!();

    // Decrement queue depth
    const depth = (queueDepth.get(userKey) ?? 1) - 1;
    if (depth <= 0) {
      queueDepth.delete(userKey);
    } else {
      queueDepth.set(userKey, depth);
    }

    // Clean up lock map if this is the last pending request
    if (locks.get(userKey) === currentLock) {
      locks.delete(userKey);
    }
  };

  res.once("finish", release);
  res.once("close", release);

  // Wait for previous request from same user, then proceed
  prev.then(() => next());
}
