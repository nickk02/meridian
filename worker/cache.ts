// Short-TTL feed cache. The Worker fetches third-party feeds server-side and
// caches the raw JSON in KV so repeated ingests and bursts stay inside feed
// rate limits. The browser never calls these feeds directly.

// KV values are capped at 25MiB; a few raw feeds (NIFC wildfire perimeters)
// exceed that. Caching is an optimization, not a correctness requirement, so
// oversized payloads just skip the cache instead of failing the whole fetch.
const KV_VALUE_LIMIT_BYTES = 25 * 1024 * 1024;

export async function cachedFetchJson<T>(
  cache: KVNamespace | undefined,
  key: string,
  url: string,
  ttlSeconds: number,
  init?: RequestInit,
): Promise<T> {
  if (cache) {
    const hit = await cache.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
  }
  const res = await fetch(url, {
    ...init,
    headers: { "user-agent": "meridian/0.1 (open-data ingest)", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`feed ${url} returned ${res.status}`);
  }
  const text = await res.text();
  if (cache && new TextEncoder().encode(text).length <= KV_VALUE_LIMIT_BYTES) {
    try {
      await cache.put(key, text, { expirationTtl: Math.max(60, ttlSeconds) });
    } catch {
      /* caching is best-effort; an ingest must not fail because the cache write did */
    }
  }
  return JSON.parse(text) as T;
}
