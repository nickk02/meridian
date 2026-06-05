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
import { resolveEntities } from "./entities";
import { countryAt } from "./geo/reverse";
import { correlate } from "./correlate";

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

// Static per-source reliability for the confidence score (Stage D).
const RELIABILITY: Record<string, number> = {
  usgs: 0.98, nws: 0.97, nhc: 0.97, nifc: 0.95, eonet: 0.95,
  gdacs: 0.95, cneos: 0.95, launchlibrary: 0.9,
  airplanes: 0.85, digitraffic: 0.85,
};

// Fallback source endpoint when a feed item has no per-event URL.
const SOURCE_URL: Record<string, string> = {
  usgs: "https://earthquake.usgs.gov/earthquakes/",
  eonet: "https://eonet.gsfc.nasa.gov/",
  gdacs: "https://www.gdacs.org/",
  nws: "https://www.weather.gov/",
  nhc: "https://www.nhc.noaa.gov/",
  nifc: "https://www.nifc.gov/",
  cneos: "https://cneos.jpl.nasa.gov/fireballs/",
  airplanes: "https://airplanes.live/",
  digitraffic: "https://www.digitraffic.fi/en/marine-traffic/",
  launchlibrary: "https://thespacedevs.com/llapi",
};

// confidence = reliability x recency. Recency decays linearly over a week to a
// floor; future-dated events (upcoming launches) read as fully current.
function confidenceFor(source: string, ts: number, now: number): number {
  const reliability = RELIABILITY[source] ?? 0.7;
  const ageDays = Math.max(0, (now - ts) / 86400000);
  const recency = Math.max(0.2, 1 - ageDays / 7);
  return Math.round(reliability * recency * 1000) / 1000;
}

// Only accept http(s) URLs, so a feed cannot inject a javascript: scheme that
// would execute when rendered as a link (anti-XSS).
function safeHttpUrl(u: unknown): string | null {
  if (typeof u !== "string") return null;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function sourceUrlFor(o: IngestObject): string | null {
  const p = o.props ?? {};
  return (
    safeHttpUrl(p["url"]) ??
    safeHttpUrl(p["report"]) ??
    safeHttpUrl(p["advisory"]) ??
    safeHttpUrl(o.source_url) ??
    SOURCE_URL[o.source] ??
    null
  );
}

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
  entities: number;
  entityLinks: number;
  incidents: number;
  correlatedLinks: number;
}

// Object ingest runs every cron (15 min) for fresh dots, but link rebuild is
// expensive (full delete + reinsert), so it is gated to roughly hourly. Stale
// dynamic objects are pruned so the working set, and the rebuild cost, stay
// bounded inside D1's free tier.
const LINK_REBUILD_MS = 55 * 60 * 1000;
const PRUNE_AGE_MS = 12 * 60 * 60 * 1000;

const UPSERT = `INSERT INTO objects
  (id, type, name, lat, lon, severity, ts, source, source_url, fetched_at,
   confidence, domain, admin0, props, first_seen, last_seen)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, lat = excluded.lat, lon = excluded.lon,
    severity = excluded.severity, ts = excluded.ts, source = excluded.source,
    source_url = excluded.source_url, fetched_at = excluded.fetched_at,
    confidence = excluded.confidence, domain = excluded.domain,
    admin0 = excluded.admin0, props = excluded.props,
    last_seen = excluded.last_seen`;

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
          sourceUrlFor(o),
          now,
          confidenceFor(o.source, o.ts, now),
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

  // Backfill admin0 from coordinates for land events the feed did not tag, so
  // every land event resolves to its country entity.
  for (const o of collected) {
    if (!o.admin0) {
      const iso3 = countryAt(o.lat, o.lon);
      if (iso3) o.admin0 = iso3;
    }
  }

  await upsertObjects(db, collected, ran);
  const ents = await resolveEntities(db, collected, ran);

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

  // Rebuild links + incidents only when due (or forced by a manual run).
  let links = -1;
  let incidents = 0;
  let correlatedLinks = 0;
  const last = await db
    .prepare("SELECT MAX(created_ts) AS m FROM links WHERE kind != 'CORRELATED_WITH'")
    .first<{ m: number | null }>();
  if (opts.forceLinks || !last?.m || ran - last.m >= LINK_REBUILD_MS) {
    links = await deriveLinks(db);
    const corr = await correlate(db, ran);
    incidents = corr.incidents;
    correlatedLinks = corr.correlatedLinks;
  }

  return {
    ran,
    sources,
    errors,
    upserted: collected.length,
    pruned,
    links,
    entities: ents.entities,
    entityLinks: ents.links,
    incidents,
    correlatedLinks,
  };
}
