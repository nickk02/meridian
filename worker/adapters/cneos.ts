// NASA CNEOS atmospheric fireball/bolide events (keyless JSON). Server-side
// fetch only (the API forbids client embedding). Coordinates are reported with
// separate N/S and E/W direction fields. Delayed, not real-time.

import type { IngestObject } from "./types";
import { cachedFetchJson } from "../cache";

const BASE = "https://ssd-api.jpl.nasa.gov/fireball.api?req-loc=true";

interface FireballResp {
  fields: string[];
  data: string[][] | null;
}

function severityForEnergy(impactKt: number): number {
  if (impactKt >= 10) return 4;
  if (impactKt >= 1) return 3;
  if (impactKt >= 0.1) return 2;
  return 1;
}

export function normalizeFireballs(resp: FireballResp): IngestObject[] {
  const f = resp.fields ?? [];
  const idx = (name: string) => f.indexOf(name);
  const iDate = idx("date");
  const iEnergy = idx("energy");
  const iImpact = idx("impact-e");
  const iLat = idx("lat");
  const iLatDir = idx("lat-dir");
  const iLon = idx("lon");
  const iLonDir = idx("lon-dir");
  const iAlt = idx("alt");
  const iVel = idx("vel");

  const out: IngestObject[] = [];
  for (const row of resp.data ?? []) {
    const latRaw = row[iLat];
    const lonRaw = row[iLon];
    if (latRaw == null || lonRaw == null) continue; // location unknown
    const lat = Number(latRaw) * (row[iLatDir] === "S" ? -1 : 1);
    const lon = Number(lonRaw) * (row[iLonDir] === "W" ? -1 : 1);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const dateStr = row[iDate];
    const ts = Date.parse(dateStr.replace(" ", "T") + "Z");
    const impactKt = Number(row[iImpact]) || 0;
    out.push({
      id: `FIREBALL-${dateStr.replace(/\D/g, "")}`,
      type: "FIREBALL",
      name: `Bolide ${impactKt.toFixed(1)} kt`,
      lat,
      lon,
      severity: severityForEnergy(impactKt),
      ts: Number.isFinite(ts) ? ts : 0,
      source: "cneos",
      props: {
        impact_energy_kt: impactKt,
        radiated_energy: Number(row[iEnergy]) || null,
        altitude_km: row[iAlt] != null ? Number(row[iAlt]) : null,
        velocity_kms: row[iVel] != null ? Number(row[iVel]) : null,
      },
    });
  }
  return out;
}

export const cneosAdapter = {
  source: "cneos",
  async fetch(cache: KVNamespace | undefined): Promise<IngestObject[]> {
    // Bound to roughly the last three years of located events.
    const since = new Date(Date.now() - 3 * 365 * 86400000)
      .toISOString()
      .slice(0, 10);
    const url = `${BASE}&date-min=${since}`;
    const resp = await cachedFetchJson<FireballResp>(cache, "feed:cneos", url, 43200);
    return normalizeFireballs(resp);
  },
};
