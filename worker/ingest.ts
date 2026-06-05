// Ingestion: pull every adapter, upsert into the ontology preserving first_seen.
// Link derivation (Phase D) is invoked at the end once links exist.

import type { IngestObject } from "./adapters/types";
import { usgsAdapter } from "./adapters/usgs";
import { eonetAdapter } from "./adapters/eonet";

const ADAPTERS = [usgsAdapter, eonetAdapter];

export interface IngestResult {
  ran: number;
  sources: { source: string; count: number }[];
  errors: { source: string; error: string }[];
  upserted: number;
}

const UPSERT = `INSERT INTO objects
  (id, type, name, lat, lon, severity, ts, source, props, first_seen, last_seen)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, lat = excluded.lat, lon = excluded.lon,
    severity = excluded.severity, ts = excluded.ts, source = excluded.source,
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
          JSON.stringify(o.props),
          now,
        ),
      ),
    );
  }
}

export async function runIngest(
  db: D1Database,
  cache: KVNamespace | undefined,
): Promise<IngestResult> {
  const ran = Date.now();
  const collected: IngestObject[] = [];
  const sources: IngestResult["sources"] = [];
  const errors: IngestResult["errors"] = [];

  for (const adapter of ADAPTERS) {
    try {
      const items = await adapter.fetch(cache);
      collected.push(...items);
      sources.push({ source: adapter.source, count: items.length });
    } catch (e) {
      errors.push({ source: adapter.source, error: String(e) });
    }
  }

  await upsertObjects(db, collected, ran);
  return { ran, sources, errors, upserted: collected.length };
}
