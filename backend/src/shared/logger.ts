/**
 * Structured logger with per-request traceId support.
 *
 * - Production: JSON lines (one object per line, machine-parseable)
 * - Development: human-readable colored output
 *
 * Usage:
 *   import { logger } from "../shared/logger";
 *   logger.info({ chain: "base", protocol: "aerodrome" }, "Pool resolved");
 *   logger.warn({ traceId: req.traceId, durationMs: 42 }, "Slow RPC");
 */

import { AsyncLocalStorage } from "node:async_hooks";

// ── Trace context ──────────────────────────────────────────────────
// AsyncLocalStorage carries the traceId through the entire request
// without having to pass it explicitly through every function call.

export interface TraceContext {
  traceId: string;
}

export const traceStore = new AsyncLocalStorage<TraceContext>();

/** Returns the current traceId or "no-trace" if outside a request. */
export function getTraceId(): string {
  return traceStore.getStore()?.traceId ?? "no-trace";
}

// ── Log levels ─────────────────────────────────────────────────────

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_NUM: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const ENV_LEVEL: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ??
  (process.env.NODE_ENV === "production" ? "info" : "debug");

// ── Formatting ─────────────────────────────────────────────────────

const IS_JSON = process.env.NODE_ENV === "production";

interface LogEntry {
  level: LogLevel;
  traceId: string;
  msg: string;
  ts: string;
  [key: string]: unknown;
}

function formatJson(entry: LogEntry): string {
  return JSON.stringify(entry);
}

const COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",  // gray
  info:  "\x1b[36m",  // cyan
  warn:  "\x1b[33m",  // yellow
  error: "\x1b[31m",  // red
};
const RESET = "\x1b[0m";

function formatPretty(entry: LogEntry): string {
  const { level, traceId, msg, ts, ...rest } = entry;
  const color = COLORS[level];
  const tag = traceId !== "no-trace" ? ` [${traceId.slice(0, 8)}]` : "";
  const extra = Object.keys(rest).length > 0
    ? " " + Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ")
    : "";
  return `${color}${level.toUpperCase().padEnd(5)}${RESET}${tag} ${msg}${extra}`;
}

function write(level: LogLevel, fields: Record<string, unknown>, msg: string): void {
  if (LEVEL_NUM[level] < LEVEL_NUM[ENV_LEVEL]) return;

  const entry: LogEntry = {
    level,
    traceId: getTraceId(),
    msg,
    ts: new Date().toISOString(),
    ...fields,
  };

  const line = IS_JSON ? formatJson(entry) : formatPretty(entry);

  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

// ── Public API ─────────────────────────────────────────────────────

function createLogFn(level: LogLevel) {
  return function log(fieldsOrMsg: Record<string, unknown> | string, msg?: string): void {
    if (typeof fieldsOrMsg === "string") {
      write(level, {}, fieldsOrMsg);
    } else {
      write(level, fieldsOrMsg, msg ?? "");
    }
  };
}

export const logger = {
  debug: createLogFn("debug"),
  info:  createLogFn("info"),
  warn:  createLogFn("warn"),
  error: createLogFn("error"),
};
