// Ingestion: pull every adapter, upsert into the ontology preserving first_seen.
// Link derivation (Phase D) is invoked at the end once links exist.

import type { IngestObject } from "./adapters/types";
import type { Domain } from "../shared/types";
import { usgsAdapter } from "./adapters/usgs";
import { eonetAdapter } from "./adapters/eonet";
import { gdacsAdapter } from "./adapters/gdacs";
import { nwsAdapter } from "./adapters/nws";
import { nhcAdapter } from "./adapters/nhc";
import { nifcAdapter } from "./adapters/nifc";
import { cneosAdapter } from "./adapters/cneos";
import { adsbAdapter } from "./adapters/adsb";
import { digitrafficAdapter } from "./adapters/digitraffic";
import { launchAdapter } from "./adapters/launch";
import { deriveLinks } from "./links";

const ADAPTERS = [
  usgsAdapter,
  eonetAdapter,
  gdacsAdapter,
  nwsAdapter,
  nhcAdapter,
  nifcAdapter,
  cneosAdapter,
  adsbAdapter,
  digitrafficAdapter,
  launchAdapter,
];

// Every source maps to exactly one domain (Stage A). Objects inherit their
// adapter's domain, so a scope is just a domain filter.
const SOURCE_DOMAIN: Record<string, Domain> = {
  usgs: "seismic",
  eonet: "environmental",
  gdacs: "disaster",
  nws: "environmental",
  nhc: "environmental",
  nifc: "environmental",
  cneos: "space",
  airplanes: "aviation",
  digitraffic: "maritime",
  launchlibrary: "space",
};

// Fast-moving sources whose stale positions are misleading: pruned aggressively
// so a landed aircraft or departed vessel drops off the map within the hour.
const FAST_SOURCES = ["airplanes", "digitraffic"];
const FAST_PRUNE_MS = 60 * 60 * 1000;

export interface IngestResult {
  ran: number;
  sources: { source: string; count: number; stale?: boolean }[];
  errors: { source: string; error: string }[];
  upserted: number;
  pruned: number;
  links: number; // -1 when the link rebuild was skipped this cycle
}

// Object ingest runs every cron (15 min) for fresh dots, but link rebuild is
// expensive (full delete + reinsert), so it is gated to roughly hourly. Stale
// dynamic objects are pruned so the working set, and the rebuild cost, stay
// bounded inside D1's free tier.
const LINK_REBUILD_MS = 55 * 60 * 1000;
const PRUNE_AGE_MS = 12 * 60 * 60 * 1000;

const UPSERT = `INSERT INTO objects
  (id, type, name, lat, lon, severity, ts, source, domain, admin0, props, first_seen, last_seen)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, lat = excluded.lat, lon = excluded.lon,
    severity = excluded.severity, ts = excluded.ts, source = excluded.source,
    domain = excluded.domain, admin0 = excluded.admin0,
    props = excluded.props, last_seen = excluded.last_seen`;

async function upsertObjects(
  db: D1Database,
  items: IngestObject[],
  now: number,
): Promise<void> {
  const stmt = db.prepare(UPSERT);
  // Chunk so a single batch stays well within D1 statement limits.
  for (let i = 0; i < items.length; i += 50) {
    const chunk = items.slice(i, i + 50);
    await db.batch(
      chunk.map((o) =>
        stmt.bind(
          o.id,
          o.type,
          o.name,
          o.lat,
          o.lon,
          o.severity,
          o.ts,
          o.source,
          SOURCE_DOMAIN[o.source] ?? "other",
          o.admin0 ?? null,
          JSON.stringify(o.props),
          now,
        ),
      ),
    );
  }
}

// R2 key for a source's raw blob at a given time: raw/{source}/{yyyy}/{mm}/{dd}/{hhmm}.json
function rawKey(source: string, ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `raw/${source}/${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/` +
    `${p(d.getUTCDate())}/${p(d.getUTCHours())}${p(d.getUTCMinutes())}.json`
  );
}

export async function runIngest(
  db: D1Database,
  cache: KVNamespace | undefined,
  raw: R2Bucket | undefined,
  opts: { forceLinks?: boolean } = {},
): Promise<IngestResult> {
  const ran = Date.now();
  const collected: IngestObject[] = [];
  const sources: IngestResult["sources"] = [];
  const errors: IngestResult["errors"] = [];

  for (const adapter of ADAPTERS) {
    try {
      // Fetch upstream, archive the raw blob to R2 (timestamped + latest), then
      // normalize from the archived blob so refinement is decoupled from fetch.
      const upstream = await adapter.fetchRaw(cache);
      let payload: unknown = upstream;
      if (raw) {
        const body = JSON.stringify(upstream);
        await raw.put(rawKey(adapter.source, ran), body);
        await raw.put(`raw/${adapter.source}/latest.json`, body);
        const stored = await raw.get(`raw/${adapter.source}/latest.json`);
        if (stored) payload = JSON.parse(await stored.text());
      }
      const items = adapter.normalize(payload);
      collected.push(...items);
      sources.push({ source: adapter.source, count: items.length });
    } catch (e) {
      // Fail soft: if the upstream is down, re-normalize the last archived blob
      // so a transient outage does not drop the layer (the R2 tier's payoff).
      if (raw) {
        try {
          const stored = await raw.get(`raw/${adapter.source}/latest.json`);
          if (stored) {
            const items = adapter.normalize(JSON.parse(await stored.text()));
            collected.push(...items);
            sources.push({ source: adapter.source, count: items.length, stale: true });
            continue;
          }
        } catch {
          /* fall through to error */
        }
      }
      errors.push({ source: adapter.source, error: String(e) });
    }
  }

  await upsertObjects(db, collected, ran);

  // Drop dynamic objects not refreshed recently; anchors are permanent.
  const prune = await db
    .prepare(
      `DELETE FROM objects
        WHERE type NOT IN ('PORT','CHOKEPOINT','AIRPORT')
          AND last_seen < ?1`,
    )
    .bind(ran - PRUNE_AGE_MS)
    .run();
  const fastPrune = await db
    .prepare(
      `DELETE FROM objects WHERE source IN (${FAST_SOURCES.map(() => "?").join(",")})
        AND last_seen < ?`,
    )
    .bind(...FAST_SOURCES, ran - FAST_PRUNE_MS)
    .run();
  const pruned = (prune.meta.changes ?? 0) + (fastPrune.meta.changes ?? 0);

  // Rebuild links only when due (or forced by a manual run).
  let links = -1;
  const last = await db
    .prepare("SELECT MAX(created_ts) AS m FROM links")
    .first<{ m: number | null }>();
  if (opts.forceLinks || !last?.m || ran - last.m >= LINK_REBUILD_MS) {
    links = await deriveLinks(db);
  }

  return { ran, sources, errors, upserted: collected.length, pruned, links };
}
