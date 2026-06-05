// Day-night terminator: the polygon covering Earth's night hemisphere at a given
// instant, for a shaded overlay on the globe. Standard solar-position math (a
// port of the well-known Leaflet.Terminator approach): compute the sun's
// equatorial position, then the terminator latitude per longitude, and close the
// ring toward whichever pole is in polar night.
import type { Feature, Polygon } from "geojson";

const D2R = Math.PI / 180;

function julian(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}
function gmst(jd: number): number {
  const d = jd - 2451545.0;
  return (18.697374558 + 24.06570982441908 * d) % 24;
}
function sunEclipticLongitude(jd: number): number {
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * D2R;
  return (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
}
function obliquity(jd: number): number {
  return (23.439 - 0.0000004 * (jd - 2451545.0)) * D2R;
}

export function computeTerminator(date: Date): Feature<Polygon> {
  const jd = julian(date);
  const lambda = sunEclipticLongitude(jd);
  const eps = obliquity(jd);
  // Sun right ascension (alpha) and declination (delta).
  const alpha = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const delta = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const sidereal = gmst(jd);

  const ring: [number, number][] = [];
  for (let lon = -180; lon <= 180; lon += 1) {
    const ha = sidereal * 15 * D2R + lon * D2R - alpha; // local hour angle
    const lat = Math.atan(-Math.cos(ha) / Math.tan(delta)) / D2R;
    ring.push([lon, lat]);
  }
  // Close the ring along whichever pole is in night (opposite the sun).
  const darkPole = delta < 0 ? 90 : -90;
  ring.push([180, darkPole], [-180, darkPole], ring[0]);

  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} };
}
