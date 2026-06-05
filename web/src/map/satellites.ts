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
