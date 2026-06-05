// IFRC Alert Hub: a global aggregator of official CAP (Common Alerting Protocol)
// alerts from national alerting authorities worldwide. GraphQL, keyless. This is
// the breadth feed that fills the gap left by NWS (US only) and GDACS (skews to
// older major disasters): live civil-protection alerts from Brazil, Germany,
// Finland, Colombia, China and dozens more.
//
// Honesty rules baked in here:
//  - We only keep alerts that carry a real CAP polygon or circle, so every dot
//    sits on the actual warned area, never stacked on a country centroid (which
//    would manufacture fake co-location in the correlation engine).
//  - We skip US alerts: NWS already ingests those with polygons, and importing
//    the same storm from two sources would read as a spurious ALERT+ALERT
//    co-occurrence.

import type { IngestObject } from "./types";
import { cachedFetchJson } from "../cache";

const ENDPOINT = "https://alerthub-api.ifrc.org/graphql/";
// The API caps a page at 100; pull the newest three pages so the working set
// spans the genuinely active alerts, not just the last few minutes.
const PAGES = [0, 100, 200];

const QUERY = (offset: number) =>
  `query{ public { alerts(order:{sent:DESC}, pagination:{limit:100, offset:${offset}}) {` +
  ` items { id sent url country { iso3 } info { event headline severity urgency` +
  ` areas { areaDesc polygons { value } circles { value } } } } } } }`;

const SEVERITY: Record<string, number> = {
  EXTREME: 4,
  SEVERE: 3,
  MODERATE: 2,
  MINOR: 1,
  UNKNOWN: 1,
};

interface CapArea {
  areaDesc: string | null;
  polygons: { value: string }[];
  circles: { value: string }[];
}
interface CapAlert {
  id: string;
  sent: string;
  url: string | null;
  country: { iso3: string | null } | null;
  info: {
    event: string | null;
    headline: string | null;
    severity: string | null;
    urgency: string | null;
    areas: CapArea[];
  } | null;
}
interface CapPayload {
  items: CapAlert[];
}

// CAP geometry is "lat,lon lat,lon ..." (latitude first, unlike GeoJSON). The
// polygon ring centroid is the mean of its vertices; good enough to place a dot
// on the warned area.
function polygonCentroid(value: string): [number, number] | null {
  let lat = 0;
  let lon = 0;
  let n = 0;
  for (const pair of value.trim().split(/\s+/)) {
    const [a, b] = pair.split(",").map(Number);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      lat += a;
      lon += b;
      n++;
    }
  }
  return n > 0 ? [lat / n, lon / n] : null;
}

// CAP circle is "lat,lon radiusKm"; the center is the point we want.
function circleCenter(value: string): [number, number] | null {
  const head = value.trim().split(/\s+/)[0] ?? "";
  const [a, b] = head.split(",").map(Number);
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

function locate(areas: CapArea[]): [number, number] | null {
  for (const a of areas) {
    for (const p of a.polygons ?? []) {
      const c = polygonCentroid(p.value);
      if (c) return c;
    }
    for (const c of a.circles ?? []) {
      const center = circleCenter(c.value);
      if (center) return center;
    }
  }
  return null;
}

export function normalizeCapAlertHub(payload: CapPayload): IngestObject[] {
  const out: IngestObject[] = [];
  const seen = new Set<string>();
  // Some authorities (e.g. Germany's DWD) publish the same alert once per
  // language under different ids: identical area, time and severity. Collapse
  // those so one event is not counted as a multi-member incident. A genuinely
  // distinct hazard sharing a centroid to ~100m, the same minute and the same
  // severity is implausible, so this only removes the bilingual duplicates.
  const placed = new Set<string>();
  for (const it of payload.items ?? []) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    const iso3 = it.country?.iso3 ?? null;
    if (iso3 === "USA") continue; // NWS already covers the US with polygons
    const info = it.info;
    if (!info) continue;
    const c = locate(info.areas ?? []);
    if (!c) continue; // zone/geocode-coded alert with no usable point; skip
    const [lat, lon] = c;
    const ts = Date.parse(it.sent);
    const severity = SEVERITY[(info.severity ?? "").toUpperCase()] ?? 1;
    const dedup = `${lat.toFixed(3)}|${lon.toFixed(3)}|${it.sent}|${severity}`;
    if (placed.has(dedup)) continue;
    placed.add(dedup);
    out.push({
      id: `CAP-${it.id}`,
      type: "ALERT",
      name: info.event || info.headline || "Alert",
      lat,
      lon,
      severity,
      ts: Number.isFinite(ts) ? ts : 0,
      source: "cap_alerthub",
      admin0: iso3 ?? undefined,
      source_url: it.url ?? undefined,
      props: {
        event: info.event ?? null,
        headline: info.headline ?? null,
        severity: info.severity ?? null,
        urgency: info.urgency ?? null,
        area: info.areas?.[0]?.areaDesc ?? null,
        country: iso3,
        url: it.url ?? null,
      },
    });
  }
  return out;
}

async function fetchPage(cache: KVNamespace | undefined, offset: number): Promise<CapAlert[]> {
  const res = await cachedFetchJson<{ data?: { public?: { alerts?: { items?: CapAlert[] } } } }>(
    cache,
    `feed:cap_alerthub:${offset}`,
    ENDPOINT,
    900,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY(offset) }),
    },
  );
  return res.data?.public?.alerts?.items ?? [];
}

export const capAlertHubAdapter = {
  source: "cap_alerthub",
  async fetchRaw(cache: KVNamespace | undefined): Promise<unknown> {
    const pages = await Promise.all(PAGES.map((o) => fetchPage(cache, o)));
    return { items: pages.flat() } satisfies CapPayload;
  },
  normalize(raw: unknown): IngestObject[] {
    return normalizeCapAlertHub(raw as CapPayload);
  },
};
