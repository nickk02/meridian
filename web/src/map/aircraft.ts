// Live aircraft overlay: fetch the current military ADS-B snapshot from the
// Worker proxy and turn it into map points. Like ships and satellites, aircraft
// are a fast-moving live overlay, not ontology objects, so this never touches D1.
import type { FeatureCollection, Feature } from "geojson";

interface Plane {
  hex: string;
  name: string;
  lat: number;
  lon: number;
  alt: number | null;
  track: number | null;
  model: string | null;
}

export async function fetchAircraft(): Promise<FeatureCollection> {
  try {
    const r = await fetch("/api/aircraft");
    if (!r.ok) return { type: "FeatureCollection", features: [] };
    const rows = (await r.json()) as Plane[];
    const features: Feature[] = [];
    for (const a of rows) {
      if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [a.lon, a.lat] },
        properties: {
          name: a.name,
          alt: a.alt ?? 0,
          model: a.model ?? "",
        },
      });
    }
    return { type: "FeatureCollection", features };
  } catch {
    return { type: "FeatureCollection", features: [] };
  }
}
