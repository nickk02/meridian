// Live ships via Digitraffic Marine AIS (Finland/Baltic, keyless; requires a
// Digitraffic-User header and gzip). The feed carries ~18k vessels, so this is
// bounded hard to actively transiting vessels and capped. Maps to VESSEL.

import type { IngestObject } from "./types";
import { cachedFetchJson } from "../cache";

const URL = "https://meri.digitraffic.fi/api/ais/v1/locations";
const MAX_VESSELS = 250;
const MIN_SOG = 8; // knots, actively transiting
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

interface AisFeature {
  geometry: { type: string; coordinates: [number, number] } | null;
  properties: {
    mmsi: number;
    sog: number; // speed over ground, knots
    cog: number; // course over ground
    navStat: number;
    heading?: number;
    timestampExternal?: number;
  };
}
interface AisFeed {
  features: AisFeature[];
}

export function normalizeDigitraffic(feed: AisFeed, now: number): IngestObject[] {
  const candidates: { o: IngestObject; sog: number }[] = [];
  for (const f of feed.features ?? []) {
    const p = f.properties;
    if (p.navStat !== 0 || p.sog < MIN_SOG) continue; // underway + moving only
    const ts = p.timestampExternal ?? 0;
    if (now - ts > MAX_AGE_MS) continue; // recent positions only
    if (!f.geometry || f.geometry.type !== "Point") continue;
    const [lon, lat] = f.geometry.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    candidates.push({
      sog: p.sog,
      o: {
        id: `SHIP-${p.mmsi}`,
        type: "VESSEL",
        name: `MMSI ${p.mmsi}`,
        lat,
        lon,
        severity: 1,
        ts,
        source: "digitraffic",
        props: {
          mmsi: p.mmsi,
          speed_kn: p.sog,
          course: p.cog,
          heading: p.heading ?? null,
          nav_status: p.navStat,
        },
      },
    });
  }
  // Keep the fastest-moving vessels when over the cap.
  candidates.sort((a, b) => b.sog - a.sog);
  return candidates.slice(0, MAX_VESSELS).map((c) => c.o);
}

export const digitrafficAdapter = {
  source: "digitraffic",
  async fetch(cache: KVNamespace | undefined): Promise<IngestObject[]> {
    const feed = await cachedFetchJson<AisFeed>(cache, "feed:digitraffic", URL, 120, {
      headers: { "Digitraffic-User": "meridian-cop", "Accept-Encoding": "gzip" },
    });
    return normalizeDigitraffic(feed, Date.now());
  },
};
