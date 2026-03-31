import { Request, Response, NextFunction } from "express";
import { AppError } from "../shared/errorCodes";
import { logger } from "../shared/logger";

// ── Sliding-window counter ─────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

type LimitStore = Map<string, RateLimitEntry>;

function check(store: LimitStore, key: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  entry.count++;
  return entry.count <= max;
}

// ── Stores (one per tier) ──────────────────────────────────────────

const ipStore      = new Map<string, RateLimitEntry>();
const userStore    = new Map<string, RateLimitEntry>();
const prepareStore = new Map<string, RateLimitEntry>();

// ── Limits ─────────────────────────────────────────────────────────

const IP_WINDOW_MS      = 60_000;  // 1 min
const IP_MAX            = 60;      // 60 req/min per IP

const USER_WINDOW_MS    = 60_000;  // 1 min
const USER_MAX          = 30;      // 30 req/min per wallet

const PREPARE_WINDOW_MS = 10_000;  // 10 s
const PREPARE_MAX       = 10;      // 10 prepare-* calls per 10s

// ── Cleanup expired entries every 5 min ────────────────────────────

function sweep(store: LimitStore): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}

setInterval(() => {
  sweep(ipStore);
  sweep(userStore);
  sweep(prepareStore);
}, 300_000);

// ── Resolve wallet address from request ────────────────────────────

function extractWallet(req: Request): string | null {
  // Body fields used across modules
  const addr =
    req.body?.userAddress ||
    req.body?.address ||
    req.params?.userAddress ||
    null;
  if (typeof addr === "string" && /^0x[a-fA-F0-9]{40}$/.test(addr)) {
    return addr.toLowerCase();
  }
  return null;
}

// ── Is this a prepare-* endpoint? ──────────────────────────────────

function isPrepareEndpoint(path: string): boolean {
  return /\/prepare-/.test(path);
}

// ── Middleware ──────────────────────────────────────────────────────

export function rateLimiter(req: Request, _res: Response, next: NextFunction) {
  const ip = req.ip ?? "unknown";

  // 1. Per-IP limit (all endpoints)
  if (!check(ipStore, ip, IP_WINDOW_MS, IP_MAX)) {
    logger.warn({ ip, tier: "ip", limit: IP_MAX }, "Rate limit exceeded");
    return next(new AppError("RATE_LIMIT_EXCEEDED", `IP rate limit exceeded (${IP_MAX} req/${IP_WINDOW_MS / 1000}s)`));
  }

  // 2. Per-user limit (when wallet address is available)
  const wallet = extractWallet(req);
  if (wallet && !check(userStore, wallet, USER_WINDOW_MS, USER_MAX)) {
    logger.warn({ wallet, tier: "user", limit: USER_MAX }, "Rate limit exceeded");
    return next(new AppError("RATE_LIMIT_EXCEEDED", `Wallet rate limit exceeded (${USER_MAX} req/${USER_WINDOW_MS / 1000}s)`));
  }

  // 3. Per-key burst limit on prepare-* endpoints
  if (isPrepareEndpoint(req.path)) {
    const prepareKey = wallet || ip;
    if (!check(prepareStore, prepareKey, PREPARE_WINDOW_MS, PREPARE_MAX)) {
      logger.warn({ key: prepareKey, tier: "prepare", limit: PREPARE_MAX }, "Rate limit exceeded");
      return next(new AppError("RATE_LIMIT_EXCEEDED", `Prepare endpoint rate limit exceeded (${PREPARE_MAX} req/${PREPARE_WINDOW_MS / 1000}s)`));
    }
  }

  next();
}
