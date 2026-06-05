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
  props: Record<string, unknown>;
}

export interface Adapter {
  source: string;
  fetch(cache: KVNamespace | undefined): Promise<IngestObject[]>;
}
