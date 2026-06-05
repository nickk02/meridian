// USGS seismic feed (keyless). GeoJSON FeatureCollection of M2.5+ in the last
// day. Normalization is a pure function so it can be tested without a network.

import type { IngestObject } from "./types";
import { cachedFetchJson } from "../cache";

// All earthquakes in the last day (every magnitude), for a dense seismic layer.
const URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";
// Significant (M4.5+) quakes over the last 30 days. These persist long enough to
// temporally overlap GDACS disaster quakes, which is what makes cross-feed
// seismic corroboration possible. Capped to the strongest, on the gated cadence.
const SIG_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson";
const SIG_CAP = 300;

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

export function normalizeUsgs(feed: UsgsFeed, source = "usgs"): IngestObject[] {
  const out: IngestObject[] = [];
  for (const f of feed.features ?? []) {
    if (!f.geometry || f.geometry.type !== "Point") continue;
    const [lon, lat, depth] = f.geometry.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const mag = typeof f.properties.mag === "number" ? f.properties.mag : 0;
    const place = f.properties.place ?? "Unknown location";
    out.push({
      // Same id scheme across both USGS feeds, so a quake present in both
      // dedups to one row on upsert.
      id: `EQ-${f.id}`,
      type: "SEISMIC",
      name: `M ${mag.toFixed(1)} ${place}`,
      lat,
      lon,
      severity: severityForMag(mag),
      ts: f.properties.time,
      source,
      props: { mag, place, depth_km: depth, url: f.properties.url },
    });
  }
  return out;
}

export const usgsAdapter = {
  source: "usgs",
  fetchRaw(cache: KVNamespace | undefined): Promise<unknown> {
    return cachedFetchJson<UsgsFeed>(cache, "feed:usgs", URL, 300);
  },
  normalize(raw: unknown): IngestObject[] {
    return normalizeUsgs(raw as UsgsFeed);
  },
};

// Significant 30-day quakes, gated to the hourly cycle. Source "usgs_sig" so it
// can be gated independently of all_day; the strongest SIG_CAP are kept.
export const usgsSigAdapter = {
  source: "usgs_sig",
  fetchRaw(cache: KVNamespace | undefined): Promise<unknown> {
    return cachedFetchJson<UsgsFeed>(cache, "feed:usgs_sig", SIG_URL, 1800);
  },
  normalize(raw: unknown): IngestObject[] {
    return normalizeUsgs(raw as UsgsFeed, "usgs_sig")
      .sort((a, b) => ((b.props.mag as number) ?? 0) - ((a.props.mag as number) ?? 0))
      .slice(0, SIG_CAP);
  },
};
