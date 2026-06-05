// Link derivation. Pure geometry (haversine + the derivation rules) is split
// from D1 I/O so distances can be checked by hand and the rules unit-tested.

import type { OntologyObject } from "../shared/types";

const ANCHOR_TYPES = new Set(["PORT", "CHOKEPOINT", "AIRPORT"]);
const PROXIMATE_MAX_KM = 1500;
const COLOCATED_MAX_KM = 400;
// Cap CO_LOCATED edges per object so dense clusters do not explode the link
// count (and the per-ingest write volume) past D1's free tier.
const COLOCATED_MAX_PER = 4;
const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface DerivedLink {
  id: string;
  source_id: string;
  target_id: string;
  kind: "PROXIMATE_TO" | "CO_LOCATED";
  basis: string;
  meta: { km: number };
  confidence: number;
}

const round = (n: number, p = 3) => Math.round(n * 10 ** p) / 10 ** p;

type GeoObject = Pick<OntologyObject, "id" | "type" | "lat" | "lon">;

// PROXIMATE_TO: each dynamic event to its single nearest anchor within 1500 km,
// confidence scaled by distance. CO_LOCATED: same-type dynamic events within
// 400 km of each other, one undirected link per pair (id order).
export function computeLinks(objects: GeoObject[]): DerivedLink[] {
  const anchors = objects.filter((o) => ANCHOR_TYPES.has(o.type));
  const dynamics = objects.filter((o) => !ANCHOR_TYPES.has(o.type));
  const links: DerivedLink[] = [];

  for (const d of dynamics) {
    let best: { anchor: GeoObject; km: number } | null = null;
    for (const a of anchors) {
      const km = haversineKm(d.lat, d.lon, a.lat, a.lon);
      if (km <= PROXIMATE_MAX_KM && (!best || km < best.km)) {
        best = { anchor: a, km };
      }
    }
    if (best) {
      links.push({
        id: `PROXIMATE_TO|${d.id}|${best.anchor.id}`,
        source_id: d.id,
        target_id: best.anchor.id,
        kind: "PROXIMATE_TO",
        basis: `spatial:nearest_anchor<=${PROXIMATE_MAX_KM}km`,
        meta: { km: round(best.km, 1) },
        confidence: round(1 - best.km / PROXIMATE_MAX_KM),
      });
    }
  }

  const seen = new Set<string>();
  for (const a of dynamics) {
    const near: { b: GeoObject; km: number }[] = [];
    for (const b of dynamics) {
      if (a.id === b.id || a.type !== b.type) continue;
      const km = haversineKm(a.lat, a.lon, b.lat, b.lon);
      if (km <= COLOCATED_MAX_KM) near.push({ b, km });
    }
    near.sort((x, y) => x.km - y.km);
    for (const { b, km } of near.slice(0, COLOCATED_MAX_PER)) {
      const [s, t] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      const key = `${s}|${t}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({
        id: `CO_LOCATED|${s}|${t}`,
        source_id: s,
        target_id: t,
        kind: "CO_LOCATED",
        basis: `spatial:same_type<=${COLOCATED_MAX_KM}km`,
        meta: { km: round(km, 1) },
        confidence: round(1 - km / COLOCATED_MAX_KM),
      });
    }
  }

  return links;
}

export async function deriveLinks(db: D1Database): Promise<number> {
  const { results } = await db
    .prepare("SELECT id, type, lat, lon FROM objects")
    .all<GeoObject>();
  const links = computeLinks(results);

  // Full rebuild while counts are low: clear and reinsert.
  await db.prepare("DELETE FROM links").run();
  if (links.length === 0) return 0;

  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO links (id, source_id, target_id, kind, basis, meta, confidence, created_ts)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  );
  for (let i = 0; i < links.length; i += 50) {
    const chunk = links.slice(i, i + 50);
    await db.batch(
      chunk.map((l) =>
        stmt.bind(
          l.id,
          l.source_id,
          l.target_id,
          l.kind,
          l.basis,
          JSON.stringify(l.meta),
          l.confidence,
          now,
        ),
      ),
    );
  }
  return links.length;
}
