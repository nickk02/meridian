// Short-TTL feed cache. The Worker fetches third-party feeds server-side and
// caches the raw JSON in KV so repeated ingests and bursts stay inside feed
// rate limits. The browser never calls these feeds directly.

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
  if (cache) {
    await cache.put(key, text, { expirationTtl: Math.max(60, ttlSeconds) });
  }
  return JSON.parse(text) as T;
}
