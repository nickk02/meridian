// USGS seismic feed (keyless). GeoJSON FeatureCollection of M2.5+ in the last
// day. Normalization is a pure function so it can be tested without a network.

import type { IngestObject } from "./types";
import { cachedFetchJson } from "../cache";

// All earthquakes in the last day (every magnitude), for a dense seismic layer.
const URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

interface UsgsFeature {
  id: string;
  properties: { mag: number | null; place: string | null; time: number; url: string };
  geometry: { type: string; coordinates: [number, number, number] } | null;
}
interface UsgsFeed {
  features: UsgsFeature[];
}

function severityForMag(mag: number): number {
  if (mag >= 6) return 4;
  if (mag >= 5) return 3;
  if (mag >= 4) return 2;
  return 1;
}

export function normalizeUsgs(feed: UsgsFeed): IngestObject[] {
  const out: IngestObject[] = [];
  for (const f of feed.features ?? []) {
    if (!f.geometry || f.geometry.type !== "Point") continue;
    const [lon, lat, depth] = f.geometry.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const mag = typeof f.properties.mag === "number" ? f.properties.mag : 0;
    const place = f.properties.place ?? "Unknown location";
    out.push({
      id: `EQ-${f.id}`,
      type: "SEISMIC",
      name: `M ${mag.toFixed(1)} ${place}`,
      lat,
      lon,
      severity: severityForMag(mag),
      ts: f.properties.time,
      source: "usgs",
      props: { mag, place, depth_km: depth, url: f.properties.url },
    });
  }
  return out;
}

export const usgsAdapter = {
  source: "usgs",
  async fetch(cache: KVNamespace | undefined): Promise<IngestObject[]> {
    const feed = await cachedFetchJson<UsgsFeed>(cache, "feed:usgs", URL, 300);
    return normalizeUsgs(feed);
  },
};
