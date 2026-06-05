// NOAA NHC active tropical cyclones (keyless JSON), native coordinates. Maps to
// the existing STORM type. Normalization is a pure function.

import type { IngestObject } from "./types";
import { cachedFetchJson } from "../cache";

const URL = "https://www.nhc.noaa.gov/CurrentStorms.json";

interface NhcStorm {
  id: string;
  name: string;
  classification: string;
  intensity: string; // sustained wind, knots
  pressure: string;
  latitudeNumeric: number;
  longitudeNumeric: number;
  movementDir?: number;
  movementSpeed?: number;
  lastUpdate?: string;
  publicAdvisory?: { url?: string };
}
interface NhcFeed {
  activeStorms: NhcStorm[] | null;
}

// Saffir-Simpson by sustained wind (kt): cat4-5 >=113, cat2-3 >=83, else (cat1,
// tropical storm, depression) 2.
function severityForWind(kt: number): number {
  if (kt >= 113) return 4;
  if (kt >= 83) return 3;
  return 2;
}

export function normalizeNhc(feed: NhcFeed): IngestObject[] {
  const out: IngestObject[] = [];
  for (const s of feed.activeStorms ?? []) {
    const lat = s.latitudeNumeric;
    const lon = s.longitudeNumeric;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const kt = Number(s.intensity);
    const ts = Date.parse(s.lastUpdate ?? "");
    out.push({
      id: `NHC-${s.id}`,
      type: "STORM",
      name: `${s.name} (${s.classification})`,
      lat,
      lon,
      severity: severityForWind(Number.isFinite(kt) ? kt : 0),
      ts: Number.isFinite(ts) ? ts : 0,
      source: "nhc",
      props: {
        classification: s.classification,
        wind_kt: Number.isFinite(kt) ? kt : null,
        pressure_mb: Number(s.pressure) || null,
        movement_dir: s.movementDir ?? null,
        movement_kt: s.movementSpeed ?? null,
        advisory: s.publicAdvisory?.url ?? null,
      },
    });
  }
  return out;
}

export const nhcAdapter = {
  source: "nhc",
  async fetch(cache: KVNamespace | undefined): Promise<IngestObject[]> {
    const feed = await cachedFetchJson<NhcFeed>(cache, "feed:nhc", URL, 1800);
    return normalizeNhc(feed);
  },
};
