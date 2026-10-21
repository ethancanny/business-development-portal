/**
 * Tiny in-process cache for read-heavy platform endpoints.
 * Serverless instances are short-lived, so this is a latency aid only —
 * correctness always comes from the summary tables, never from here.
 */

interface CacheEntry {
  value: unknown;
  expires: number;
}

const store = new Map<string, CacheEntry>();

export const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs: number = DEFAULT_TTL_MS): void {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

/** Drop every key equal to or starting with `prefix`. */
export function cacheInvalidate(prefix: string): void {
  for (const key of Array.from(store.keys())) {
    if (key === prefix || key.startsWith(prefix)) store.delete(key);
  }
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await fn();
  cacheSet(key, value, ttlMs);
  return value;
}
