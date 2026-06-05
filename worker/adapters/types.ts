import type { ObjectTypeId } from "../../shared/types";

// What an adapter produces per item. first_seen/last_seen are assigned by the
// ingest upsert, not the adapter.
export interface IngestObject {
  id: string;
  type: ObjectTypeId;
  name: string;
  lat: number;
  lon: number;
  severity: number;
  ts: number;
  source: string;
  // ISO 3166-1 alpha-3, set by adapters whose feed carries it; otherwise
  // backfilled from coordinates by the gazetteer (Stage C).
  admin0?: string;
  // Per-event upstream URL when the feed provides one; ingest falls back to the
  // source's endpoint otherwise (Stage D provenance).
  source_url?: string;
  props: Record<string, unknown>;
}

// Stage B split: fetchRaw pulls upstream JSON (cached in KV), normalize is a
// pure function from raw payload to typed objects. Ingestion writes the raw to
// R2 between the two, so normalization runs against the archived blob.
export interface Adapter {
  source: string;
  fetchRaw(cache: KVNamespace | undefined): Promise<unknown>;
  normalize(raw: unknown): IngestObject[];
}
