/**
 * Short-lived in-process cache. No Redis. Lost on restart (acceptable).
 * Keys must include auth/user scope when caching user-specific data.
 * TTL defaults to DASHBOARD_CACHE_TTL_MS (15s).
 */

import { usageMetrics } from './usage-metrics';

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

function defaultTtlMs(): number {
  const raw = process.env.DASHBOARD_CACHE_TTL_MS;
  const n = raw ? parseInt(raw, 10) : 15_000;
  return Number.isFinite(n) && n > 0 ? n : 15_000;
}

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key) as Entry<T> | undefined;
  if (!entry) {
    usageMetrics.incr('cacheMisses');
    return undefined;
  }
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    usageMetrics.incr('cacheMisses');
    return undefined;
  }
  usageMetrics.incr('cacheHits');
  return entry.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs = defaultTtlMs()): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheInvalidate(prefixOrExact: string): void {
  if (store.has(prefixOrExact)) {
    store.delete(prefixOrExact);
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefixOrExact)) store.delete(key);
  }
}

export function cacheClear(): void {
  store.clear();
}

export function cacheSize(): number {
  return store.size;
}

export function getCacheDefaultTtlMs(): number {
  return defaultTtlMs();
}
