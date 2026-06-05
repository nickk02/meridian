// NASA EONET v3 open natural events (keyless). Each event carries a category
// and a time-ordered list of geometries; we take the most recent geometry.

import type { IngestObject } from "./types";
import type { ObjectTypeId } from "../../shared/types";
import { cachedFetchJson } from "../cache";

// Bound to recent activity: open events with data in the last 30 days. Keeps
// the picture current and the per-ingest write volume inside D1's free tier.
const URL = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30";
const CACHE_KEY = "feed:eonet:d30";

const CATEGORY_TYPE: Record<string, ObjectTypeId> = {
  wildfires: "WILDFIRE",
  severeStorms: "STORM",
  volcanoes: "VOLCANO",
  seaLakeIce: "ICE",
  floods: "FLOOD",
};

const TYPE_SEVERITY: Partial<Record<ObjectTypeId, number>> = {
  VOLCANO: 3,
  STORM: 2,
  WILDFIRE: 2,
  FLOOD: 2,
  ICE: 1,
};

interface EonetGeometry {
  date: string;
  type: string;
  coordinates: unknown;
}
interface EonetEvent {
  id: string;
  title: string;
  categories: { id: string; title: string }[];
  geometry: EonetGeometry[];
}
interface EonetFeed {
  events: EonetEvent[];
}

// First [lon, lat] pair from a Point or Polygon geometry.
function firstLonLat(g: EonetGeometry): [number, number] | null {
  const c = g.coordinates;
  if (g.type === "Point" && Array.isArray(c) && typeof c[0] === "number") {
    return [c[0] as number, c[1] as number];
  }
  if (g.type === "Polygon" && Array.isArray(c)) {
    const ring = (c as unknown[])[0];
    if (Array.isArray(ring) && Array.isArray(ring[0])) {
      const pt = ring[0] as number[];
      return [pt[0], pt[1]];
    }
  }
  return null;
}

export function normalizeEonet(feed: EonetFeed): IngestObject[] {
  const out: IngestObject[] = [];
  for (const ev of feed.events ?? []) {
    const cat = ev.categories?.[0]?.id;
    const type = cat ? CATEGORY_TYPE[cat] : undefined;
    if (!type) continue;
    const geoms = ev.geometry ?? [];
    if (geoms.length === 0) continue;
    const last = geoms[geoms.length - 1];
    const lonlat = firstLonLat(last);
    if (!lonlat) continue;
    const [lon, lat] = lonlat;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const ts = Date.parse(last.date);
    out.push({
      id: `EO-${ev.id}`,
      type,
      name: ev.title,
      lat,
      lon,
      severity: TYPE_SEVERITY[type] ?? 2,
      ts: Number.isFinite(ts) ? ts : 0,
      source: "eonet",
      props: { category: ev.categories?.[0]?.title ?? cat, event_id: ev.id },
    });
  }
  return out;
}

export const eonetAdapter = {
  source: "eonet",
  async fetch(cache: KVNamespace | undefined): Promise<IngestObject[]> {
    const feed = await cachedFetchJson<EonetFeed>(cache, CACHE_KEY, URL, 600);
    return normalizeEonet(feed);
  },
};
