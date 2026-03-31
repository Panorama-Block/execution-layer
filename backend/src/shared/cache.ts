/**
 * Simple in-memory TTL cache backed by a Map.
 *
 * Usage:
 *   const myCache = createCache<MyType>();
 *   setCache(myCache, "key", value, 30_000);   // 30s TTL
 *   const hit = getCached(myCache, "key");      // MyType | null
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export type TTLCache<T = unknown> = Map<string, CacheEntry<T>>;

/** Create a new typed cache instance. */
export function createCache<T = unknown>(): TTLCache<T> {
  return new Map();
}

/** Retrieve a cached value. Returns `null` when missing or expired. */
export function getCached<T>(cache: TTLCache<T>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

/** Store a value in the cache with a TTL in milliseconds. */
export function setCache<T>(cache: TTLCache<T>, key: string, value: T, ttlMs: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}
