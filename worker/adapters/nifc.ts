// NIFC / WFIGS current interagency wildfire perimeters (keyless ArcGIS GeoJSON).
// US active fires as polygons; we take the centroid and map to WILDFIRE.
// Prescribed burns are filtered out. Normalization is a pure function.

import type { IngestObject } from "./types";
import { cachedFetchJson } from "../cache";

const URL =
  "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/" +
  "WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=1%3D1" +
  "&outFields=poly_IncidentName,poly_GISAcres,poly_DateCurrent," +
  "attr_UniqueFireIdentifier,attr_FireDiscoveryDateTime,attr_IncidentTypeCategory" +
  "&f=geojson&resultRecordCount=1500";

interface NifcFeature {
  geometry: { type: string; coordinates: unknown } | null;
  properties: {
    poly_IncidentName?: string;
    poly_GISAcres?: number;
    poly_DateCurrent?: number;
    attr_UniqueFireIdentifier?: string;
    attr_FireDiscoveryDateTime?: number;
    attr_IncidentTypeCategory?: string;
  };
}
interface NifcFeed {
  features: NifcFeature[];
}

function ringCentroid(ring: number[][]): [number, number] | null {
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let lon = 0;
  let lat = 0;
  for (const p of ring) {
    lon += p[0];
    lat += p[1];
  }
  return [lon / ring.length, lat / ring.length];
}
function centroid(geom: { type: string; coordinates: unknown }): [number, number] | null {
  if (geom.type === "Polygon") return ringCentroid((geom.coordinates as number[][][])[0]);
  if (geom.type === "MultiPolygon") return ringCentroid((geom.coordinates as number[][][][])[0][0]);
  return null;
}

function severityForAcres(acres: number): number {
  if (acres >= 100000) return 4;
  if (acres >= 10000) return 3;
  if (acres >= 1000) return 2;
  return 1;
}

export function normalizeNifc(feed: NifcFeed): IngestObject[] {
  const out: IngestObject[] = [];
  for (const f of feed.features ?? []) {
    const p = f.properties;
    if (p.attr_IncidentTypeCategory === "RX") continue; // skip prescribed burns
    const id = p.attr_UniqueFireIdentifier;
    if (!id || !f.geometry) continue;
    const c = centroid(f.geometry);
    if (!c) continue;
    const [lon, lat] = c;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const acres = typeof p.poly_GISAcres === "number" ? p.poly_GISAcres : 0;
    out.push({
      id: `NIFC-${id}`,
      type: "WILDFIRE",
      name: p.poly_IncidentName ? `${p.poly_IncidentName} Fire` : "Wildfire",
      lat,
      lon,
      severity: severityForAcres(acres),
      ts: p.poly_DateCurrent ?? p.attr_FireDiscoveryDateTime ?? 0,
      source: "nifc",
      props: {
        acres: Math.round(acres),
        discovered: p.attr_FireDiscoveryDateTime ?? null,
        fire_id: id,
      },
    });
  }
  return out;
}

export const nifcAdapter = {
  source: "nifc",
  async fetch(cache: KVNamespace | undefined): Promise<IngestObject[]> {
    const feed = await cachedFetchJson<NifcFeed>(cache, "feed:nifc", URL, 21600);
    return normalizeNifc(feed);
  },
};
