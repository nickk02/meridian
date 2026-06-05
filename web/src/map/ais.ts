// Live global AIS overlay: fetch the latest vessel snapshot from the collector
// Durable Object (via the Worker) and turn it into map points. Like satellites,
// vessels are a live overlay, not ontology objects, so this never touches D1.
import type { FeatureCollection, Feature } from "geojson";

interface Vessel {
  mmsi: string;
  name: string;
  lat: number;
  lon: number;
}

export async function fetchAis(): Promise<FeatureCollection> {
  try {
    const r = await fetch("/api/ais");
    if (!r.ok) return { type: "FeatureCollection", features: [] };
    const rows = (await r.json()) as Vessel[];
    const features: Feature[] = [];
    for (const v of rows) {
      if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) continue;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [v.lon, v.lat] },
        properties: { name: v.name || v.mmsi },
      });
    }
    return { type: "FeatureCollection", features };
  } catch {
    return { type: "FeatureCollection", features: [] };
  }
}
