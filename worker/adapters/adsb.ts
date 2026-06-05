// Military aircraft via the airplanes.live ADS-B mesh (keyless, ADSBExchange v2
// schema, native coords). Server-side poll only; rate limit is 1 req/s and the
// cron runs once per cycle. Maps to the existing AIRCRAFT type.

import type { IngestObject } from "./types";
import { cachedFetchJson } from "../cache";

const URL = "https://api.airplanes.live/v2/mil";

interface Aircraft {
  hex: string;
  flight?: string;
  r?: string;
  t?: string;
  desc?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string;
  gs?: number;
  track?: number;
  squawk?: string;
  seen_pos?: number;
}
interface AdsbResp {
  ac: Aircraft[] | null;
}

export function normalizeAdsb(resp: AdsbResp, now: number): IngestObject[] {
  const out: IngestObject[] = [];
  for (const a of resp.ac ?? []) {
    if (typeof a.lat !== "number" || typeof a.lon !== "number") continue;
    if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
    const callsign = (a.flight ?? "").trim();
    const alt = typeof a.alt_baro === "number" ? a.alt_baro : null;
    out.push({
      id: `ACFT-${a.hex}`,
      type: "AIRCRAFT",
      name: callsign || a.r || a.hex.toUpperCase(),
      lat: a.lat,
      lon: a.lon,
      severity: 1,
      ts: now - (a.seen_pos ?? 0) * 1000,
      source: "airplanes",
      props: {
        hex: a.hex,
        callsign: callsign || null,
        registration: a.r ?? null,
        model: a.desc ?? a.t ?? null,
        altitude_ft: alt,
        ground_speed_kt: typeof a.gs === "number" ? Math.round(a.gs) : null,
        track: a.track ?? null,
        squawk: a.squawk ?? null,
      },
    });
  }
  return out;
}

export const adsbAdapter = {
  source: "airplanes",
  fetchRaw(cache: KVNamespace | undefined): Promise<unknown> {
    return cachedFetchJson<AdsbResp>(cache, "feed:airplanes", URL, 60);
  },
  normalize(raw: unknown): IngestObject[] {
    return normalizeAdsb(raw as AdsbResp, Date.now());
  },
};
