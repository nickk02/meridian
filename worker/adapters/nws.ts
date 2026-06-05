// NWS / api.weather.gov active alerts (keyless, User-Agent required). GeoJSON.
// Polygon alerts get a centroid; zone-coded (null-geometry) alerts are skipped
// until zone-centroid geocoding exists. Normalization is a pure function.

import type { IngestObject } from "./types";
import { cachedFetchJson } from "../cache";

const URL = "https://api.weather.gov/alerts/active";

const SEVERITY: Record<string, number> = {
  Extreme: 4,
  Severe: 3,
  Moderate: 2,
  Minor: 1,
  Unknown: 1,
};

interface NwsFeature {
  geometry: { type: string; coordinates: unknown } | null;
  properties: {
    id: string;
    event: string;
    severity: string;
    certainty?: string;
    urgency?: string;
    headline?: string;
    areaDesc?: string;
    sent?: string;
    effective?: string;
  };
}
interface NwsFeed {
  features: NwsFeature[];
}

// Mean of a [lon,lat] ring.
function ringCentroid(ring: number[][]): [number, number] | null {
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let lon = 0;
  let lat = 0;
  for (const p of ring) {
    lon += p[0];
    lat += p[1];
  }
  return [lon / ring.length, lat / ring.length];
}

function centroid(geom: { type: string; coordinates: unknown }): [number, number] | null {
  if (geom.type === "Polygon") {
    return ringCentroid((geom.coordinates as number[][][])[0]);
  }
  if (geom.type === "MultiPolygon") {
    return ringCentroid((geom.coordinates as number[][][][])[0][0]);
  }
  return null;
}

export function normalizeNws(feed: NwsFeed): IngestObject[] {
  const out: IngestObject[] = [];
  for (const f of feed.features ?? []) {
    if (!f.geometry) continue; // zone-coded alert, needs UGC centroid (deferred)
    const c = centroid(f.geometry);
    if (!c) continue;
    const [lon, lat] = c;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const p = f.properties;
    const ts = Date.parse(p.sent ?? p.effective ?? "");
    out.push({
      id: `NWS-${p.id}`,
      type: "ALERT",
      name: p.event,
      lat,
      lon,
      severity: SEVERITY[p.severity] ?? 1,
      ts: Number.isFinite(ts) ? ts : 0,
      source: "nws",
      props: {
        headline: p.headline ?? null,
        area: p.areaDesc ?? null,
        certainty: p.certainty ?? null,
        urgency: p.urgency ?? null,
      },
    });
  }
  return out;
}

export const nwsAdapter = {
  source: "nws",
  fetchRaw(cache: KVNamespace | undefined): Promise<unknown> {
    return cachedFetchJson<NwsFeed>(cache, "feed:nws", URL, 300);
  },
  normalize(raw: unknown): IngestObject[] {
    return normalizeNws(raw as NwsFeed);
  },
};
