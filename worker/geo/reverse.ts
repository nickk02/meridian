// Reverse-geocode a coordinate to a country ISO3 by point-in-polygon against a
// compacted Natural Earth admin-0 set (coords rounded to ~1km). Bundled so no
// per-object database call is needed. Ocean points resolve to null.

import countries from "./countries.json";

interface Country {
  iso3: string;
  bbox: [number, number, number, number];
  polys: number[][][][]; // [polygon][ring][point][lon,lat]; ring 0 = outer
}

const COUNTRIES = countries as Country[];

function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function countryAt(lat: number, lon: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const c of COUNTRIES) {
    const [minx, miny, maxx, maxy] = c.bbox;
    if (lon < minx || lon > maxx || lat < miny || lat > maxy) continue;
    for (const poly of c.polys) {
      if (!pointInRing(lon, lat, poly[0])) continue;
      let inHole = false;
      for (let h = 1; h < poly.length; h++) {
        if (pointInRing(lon, lat, poly[h])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return c.iso3;
    }
  }
  return null;
}
