// Satellite layer: fetch TLEs (via the Worker proxy), propagate orbits with
// SGP4 (satellite.js) on the client, and render sub-satellite points that march
// across the globe in real time. Satellites are a live overlay, not ontology
// events, so none of this touches D1.
import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
  type SatRec,
} from "satellite.js";
import type { FeatureCollection, Feature } from "geojson";

export interface Sat {
  name: string;
  rec: SatRec;
}

// Parse a CelesTrak TLE text block (name, line1, line2 triples) into satrecs.
export async function fetchSats(): Promise<Sat[]> {
  const r = await fetch("/api/tle");
  if (!r.ok) return [];
  const lines = (await r.text()).split("\n").map((l) => l.trimEnd());
  const sats: Sat[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].startsWith("1 ") && lines[i + 1].startsWith("2 ")) {
      const name = i > 0 && !lines[i - 1].startsWith("1 ") ? lines[i - 1].trim() : "SAT";
      try {
        sats.push({ name, rec: twoline2satrec(lines[i], lines[i + 1]) });
      } catch {
        /* skip malformed */
      }
      i++; // consume line 2
    }
  }
  return sats;
}

export interface SatPoint {
  name: string;
  lon: number;
  lat: number;
  altKm: number;
}

// Sub-satellite points with true altitude, for the 3D (deck.gl) globe overlay.
// Same propagation as propagateSats but it keeps the height instead of flattening
// to the surface.
export function propagateSatsRaw(sats: Sat[], date: Date): SatPoint[] {
  const gmst = gstime(date);
  const out: SatPoint[] = [];
  for (const s of sats) {
    const pv = propagate(s.rec, date);
    const pos = pv && pv.position;
    if (!pos || typeof pos === "boolean") continue;
    const geo = eciToGeodetic(pos, gmst);
    const lon = degreesLong(geo.longitude);
    const lat = degreesLat(geo.latitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(geo.height)) continue;
    out.push({ name: s.name, lon, lat, altKm: geo.height });
  }
  return out;
}

export interface OrbitArc {
  name: string;
  path: [number, number, number][]; // [lon, lat, altMeters]
}

// One full orbital period for a capped, low-orbit subset of sats, sampled into
// polylines at true altitude so the arcs read as orbits hugging the globe. Higher
// orbits (GPS MEO) are skipped here: their arcs are 3x the earth radius and would
// sweep off-screen at the clamped globe zoom. Paths are split at the antimeridian
// so no segment streaks across the globe.
export function orbitArcs(sats: Sat[], date: Date, maxCount: number, samples = 96): OrbitArc[] {
  const step = Math.max(1, Math.floor(sats.length / maxCount));
  const out: OrbitArc[] = [];
  for (let i = 0; i < sats.length && out.length < maxCount; i += step) {
    const s = sats[i];
    const periodMin = (2 * Math.PI) / s.rec.no; // satrec.no is rad/min
    if (!Number.isFinite(periodMin) || periodMin <= 0) continue;
    let seg: [number, number, number][] = [];
    let prevLon: number | null = null;
    let isLeo = true;
    for (let k = 0; k <= samples; k++) {
      const t = new Date(date.getTime() + (periodMin * 60000 * k) / samples);
      const gmst = gstime(t);
      const pv = propagate(s.rec, t);
      const pos = pv && pv.position;
      if (!pos || typeof pos === "boolean") continue;
      const geo = eciToGeodetic(pos, gmst);
      if (geo.height > 2000) { isLeo = false; break; } // skip MEO/GEO arcs
      const lon = degreesLong(geo.longitude);
      const lat = degreesLat(geo.latitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (prevLon != null && Math.abs(lon - prevLon) > 180) {
        if (seg.length > 1) out.push({ name: s.name, path: seg });
        seg = [];
      }
      seg.push([lon, lat, geo.height * 1000]);
      prevLon = lon;
    }
    if (isLeo && seg.length > 1) out.push({ name: s.name, path: seg });
  }
  return out;
}

// Current sub-satellite points for the given instant.
export function propagateSats(sats: Sat[], date: Date): FeatureCollection {
  const gmst = gstime(date);
  const features: Feature[] = [];
  for (const s of sats) {
    const pv = propagate(s.rec, date);
    const pos = pv && pv.position;
    if (!pos || typeof pos === "boolean") continue;
    const geo = eciToGeodetic(pos, gmst);
    const lon = degreesLong(geo.longitude);
    const lat = degreesLat(geo.latitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { name: s.name, alt: Math.round(geo.height) },
    });
  }
  return { type: "FeatureCollection", features };
}
