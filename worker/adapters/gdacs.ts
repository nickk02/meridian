// GDACS (UN/EC Global Disaster Alert and Coordination System), keyless GeoJSON.
// Alert-graded multi-hazard events with native coordinates. Normalization is a
// pure function so it can be tested without a network.

import type { IngestObject } from "./types";
import type { ObjectTypeId } from "../../shared/types";
import { cachedFetchJson } from "../cache";

const URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH";

const TYPE: Record<string, ObjectTypeId> = {
  EQ: "SEISMIC",
  TC: "STORM",
  FL: "FLOOD",
  VO: "VOLCANO",
  WF: "WILDFIRE",
  DR: "DROUGHT",
};
const SEVERITY: Record<string, number> = { Red: 4, Orange: 3, Green: 2 };

interface GdacsFeature {
  geometry: { type: string; coordinates: [number, number] } | null;
  properties: {
    eventtype: string;
    eventid: number;
    name: string;
    alertlevel: string;
    fromdate: string;
    datemodified: string;
    country?: string;
    iso3?: string;
    severitydata?: { severitytext?: string };
    url?: { report?: string };
  };
}
interface GdacsFeed {
  features: GdacsFeature[];
}

// GDACS timestamps are UTC without a zone suffix; append Z so Date.parse is UTC.
function parseUtc(s: string | undefined): number {
  if (!s) return 0;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");
  return Number.isFinite(t) ? t : 0;
}

// Keep only recent disasters: GDACS tracks events for 3-5 months, but a months-
// old closed disaster has no fresh detail-feed counterpart, so it can never
// corroborate and only clutters the map. Bounding to this window aligns GDACS
// with the detail feeds (USGS 30-day, FIRMS/NWS fresh).
const MAX_AGE_MS = 30 * 24 * 3600_000;

export function normalizeGdacs(feed: GdacsFeed): IngestObject[] {
  const out: IngestObject[] = [];
  const now = Date.now();
  for (const f of feed.features ?? []) {
    const p = f.properties;
    const type = TYPE[p.eventtype];
    if (!type || !f.geometry || f.geometry.type !== "Point") continue;
    const [lon, lat] = f.geometry.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // Timestamp for correlation: a drought is an ongoing condition (use when it
    // was last updated), every other type is a point event (use when it struck),
    // so its time aligns with the same event in the detail feeds.
    const ts =
      type === "DROUGHT"
        ? parseUtc(p.datemodified) || parseUtc(p.fromdate)
        : parseUtc(p.fromdate) || parseUtc(p.datemodified);
    if (ts > 0 && now - ts > MAX_AGE_MS) continue; // drop stale disasters
    out.push({
      id: `GDACS-${p.eventtype}-${p.eventid}`,
      type,
      name: p.name,
      lat,
      lon,
      severity: SEVERITY[p.alertlevel] ?? 2,
      ts,
      source: "gdacs",
      admin0: p.iso3 && p.iso3.length === 3 ? p.iso3 : undefined,
      props: {
        alertlevel: p.alertlevel,
        country: p.country ?? p.iso3 ?? null,
        impact: p.severitydata?.severitytext ?? null,
        report: p.url?.report ?? null,
      },
    });
  }
  return out;
}

export const gdacsAdapter = {
  source: "gdacs",
  fetchRaw(cache: KVNamespace | undefined): Promise<unknown> {
    return cachedFetchJson<GdacsFeed>(cache, "feed:gdacs", URL, 900);
  },
  normalize(raw: unknown): IngestObject[] {
    return normalizeGdacs(raw as GdacsFeed);
  },
};
