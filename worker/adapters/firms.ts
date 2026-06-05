// NASA FIRMS active-fire detections (VIIRS S-NPP), global, last 24h. Keyed
// (NASA_MAP_KEY). Raw VIIRS is ~10k points/day, far too many for the write
// budget, so normalize grid-dedups to one strongest detection per ~0.5 deg cell
// and caps the result. Cell+date ids keep re-ingests idempotent.
import type { IngestObject } from "./types";
import type { Adapter } from "./types";

const FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const CELL = 0.5; // grid cell size in degrees for dedup
const CAP = 200; // max fires emitted per ingest (keeps the write budget safe)
const MIN_FRP = 8; // MW; drop the faintest detections (noise / small burns)

function sevForFrp(frp: number): number {
  if (frp >= 100) return 3;
  if (frp >= 40) return 2;
  return 1;
}

// FIRMS acq_time is HHMM as an integer (UTC), e.g. 13 -> 00:13, 1300 -> 13:00.
function fireTs(date: string, time: string): number {
  const t = Number(time) || 0;
  const hh = String(Math.floor(t / 100)).padStart(2, "0");
  const mm = String(t % 100).padStart(2, "0");
  const ms = Date.parse(`${date}T${hh}:${mm}:00Z`);
  return Number.isFinite(ms) ? ms : Date.parse(`${date}T00:00:00Z`);
}

export function normalizeFirms(csv: string): IngestObject[] {
  const lines = csv.split("\n").filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  const col = (name: string) => header.indexOf(name);
  const iLat = col("latitude");
  const iLon = col("longitude");
  const iConf = col("confidence");
  const iFrp = col("frp");
  const iDate = col("acq_date");
  const iTime = col("acq_time");
  if (iLat < 0 || iLon < 0 || iFrp < 0) return [];

  // Strongest detection per grid cell (by FRP).
  const best = new Map<string, { lat: number; lon: number; frp: number; date: string; time: string }>();
  for (let i = 1; i < lines.length; i++) {
    const r = lines[i].split(",");
    const conf = (r[iConf] ?? "").trim().toLowerCase();
    if (conf === "l" || conf === "low") continue; // drop low-confidence
    const lat = Number(r[iLat]);
    const lon = Number(r[iLon]);
    const frp = Number(r[iFrp]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(frp)) continue;
    if (frp < MIN_FRP) continue;
    const cellLat = Math.round(lat / CELL) * CELL;
    const cellLon = Math.round(lon / CELL) * CELL;
    const key = `${cellLat},${cellLon}`;
    const prev = best.get(key);
    if (!prev || frp > prev.frp) {
      best.set(key, { lat: cellLat, lon: cellLon, frp, date: r[iDate] ?? "", time: r[iTime] ?? "0" });
    }
  }

  return [...best.values()]
    .sort((a, b) => b.frp - a.frp)
    .slice(0, CAP)
    .map((f) => ({
      id: `FIRMS-${f.lat.toFixed(1)}-${f.lon.toFixed(1)}-${f.date}`,
      type: "WILDFIRE" as const,
      name: `Active fire (${Math.round(f.frp)} MW)`,
      lat: f.lat,
      lon: f.lon,
      severity: sevForFrp(f.frp),
      ts: fireTs(f.date, f.time),
      source: "firms",
      props: { frp: f.frp, detector: "VIIRS S-NPP" },
    }));
}

export const firmsAdapter: Adapter = {
  source: "firms",
  async fetchRaw(_cache, keys) {
    const key = keys?.["NASA_MAP_KEY"];
    if (!key) return "";
    const r = await fetch(`${FIRMS_BASE}/${key}/VIIRS_SNPP_NRT/world/1`, {
      headers: { "user-agent": "meridian-cop (github.com/nickk02/meridian)" },
    });
    return r.ok ? await r.text() : "";
  },
  normalize(raw) {
    return normalizeFirms(typeof raw === "string" ? raw : "");
  },
};
