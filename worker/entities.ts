// Stage C: resolve events to canonical entities by deterministic keys. An
// aircraft seen across many ticks resolves to one aircraft entity (ICAO hex); a
// vessel to one entity (MMSI); a country-tagged event links to its country
// (ISO3). Every link records its basis (source) and a confidence.

import type { IngestObject } from "./adapters/types";

// Compact ISO3 -> name for readable country entities; falls back to the code.
const COUNTRY_NAME: Record<string, string> = {
  USA: "United States", CHN: "China", RUS: "Russia", IND: "India",
  JPN: "Japan", DEU: "Germany", GBR: "United Kingdom", FRA: "France",
  ITA: "Italy", BRA: "Brazil", CAN: "Canada", AUS: "Australia",
  ESP: "Spain", MEX: "Mexico", IDN: "Indonesia", TUR: "Turkey",
  KOR: "South Korea", SAU: "Saudi Arabia", ARG: "Argentina", ZAF: "South Africa",
  NLD: "Netherlands", CHE: "Switzerland", PHL: "Philippines", EGY: "Egypt",
  NGA: "Nigeria", PAK: "Pakistan", BGD: "Bangladesh", VNM: "Vietnam",
  IRN: "Iran", THA: "Thailand", MYS: "Malaysia", COL: "Colombia",
  CHL: "Chile", PER: "Peru", NZL: "New Zealand", GRC: "Greece",
  PRT: "Portugal", SWE: "Sweden", NOR: "Norway", FIN: "Finland",
  DNK: "Denmark", POL: "Poland", UKR: "Ukraine", AFG: "Afghanistan",
  IRQ: "Iraq", SYR: "Syria", YEM: "Yemen", ETH: "Ethiopia",
  KEN: "Kenya", MAR: "Morocco", DZA: "Algeria", VEN: "Venezuela",
  ECU: "Ecuador", MMR: "Myanmar", NPL: "Nepal", LKA: "Sri Lanka",
  ALB: "Albania", TWN: "Taiwan", PNG: "Papua New Guinea", FJI: "Fiji",
};

interface EntityRow {
  id: string;
  type: string;
  canonical_name: string;
  admin0: string | null;
  lat: number | null;
  lon: number | null;
}
interface LinkRow {
  event_id: string;
  entity_id: string;
  role: string;
  source: string;
  confidence: number;
}

function deriveForObject(o: IngestObject): { entity: EntityRow; link: LinkRow }[] {
  const out: { entity: EntityRow; link: LinkRow }[] = [];

  if (o.source === "airplanes" && typeof o.props?.["hex"] === "string") {
    const hex = (o.props["hex"] as string).toLowerCase();
    out.push({
      entity: {
        id: `ENT-ACFT-${hex}`,
        type: "aircraft",
        canonical_name: o.name,
        admin0: null,
        lat: o.lat,
        lon: o.lon,
      },
      link: {
        event_id: o.id,
        entity_id: `ENT-ACFT-${hex}`,
        role: "is",
        source: "deterministic:icao_hex",
        confidence: 1.0,
      },
    });
  }

  if (o.source === "digitraffic" && o.props?.["mmsi"] != null) {
    const mmsi = String(o.props["mmsi"]);
    out.push({
      entity: {
        id: `ENT-VESSEL-${mmsi}`,
        type: "vessel",
        canonical_name: `MMSI ${mmsi}`,
        admin0: null,
        lat: o.lat,
        lon: o.lon,
      },
      link: {
        event_id: o.id,
        entity_id: `ENT-VESSEL-${mmsi}`,
        role: "is",
        source: "deterministic:mmsi",
        confidence: 1.0,
      },
    });
  }

  if (o.admin0 && /^[A-Z]{3}$/.test(o.admin0)) {
    out.push({
      entity: {
        id: `ENT-COUNTRY-${o.admin0}`,
        type: "country",
        canonical_name: COUNTRY_NAME[o.admin0] ?? o.admin0,
        admin0: o.admin0,
        lat: null,
        lon: null,
      },
      link: {
        event_id: o.id,
        entity_id: `ENT-COUNTRY-${o.admin0}`,
        role: "located_in",
        source: "feed:admin0",
        confidence: 1.0,
      },
    });
  }

  return out;
}

const UPSERT_ENTITY = `INSERT INTO entities
  (id, type, canonical_name, admin0, lat, lon, first_seen, last_seen)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
  ON CONFLICT(id) DO UPDATE SET
    canonical_name = excluded.canonical_name,
    lat = COALESCE(excluded.lat, entities.lat),
    lon = COALESCE(excluded.lon, entities.lon),
    last_seen = excluded.last_seen`;

const UPSERT_LINK = `INSERT INTO entity_links
  (id, event_id, entity_id, role, source, confidence, created_ts)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  ON CONFLICT(id) DO UPDATE SET
    confidence = excluded.confidence, created_ts = excluded.created_ts`;

export async function resolveEntities(
  db: D1Database,
  items: IngestObject[],
  now: number,
): Promise<{ entities: number; links: number }> {
  const entityStmt = db.prepare(UPSERT_ENTITY);
  const linkStmt = db.prepare(UPSERT_LINK);
  const seenEntities = new Map<string, EntityRow>();
  const links: LinkRow[] = [];

  for (const o of items) {
    for (const { entity, link } of deriveForObject(o)) {
      seenEntities.set(entity.id, entity);
      links.push(link);
    }
  }

  const entityRows = [...seenEntities.values()];
  for (let i = 0; i < entityRows.length; i += 50) {
    await db.batch(
      entityRows.slice(i, i + 50).map((e) =>
        entityStmt.bind(e.id, e.type, e.canonical_name, e.admin0, e.lat, e.lon, now),
      ),
    );
  }
  for (let i = 0; i < links.length; i += 50) {
    await db.batch(
      links.slice(i, i + 50).map((l) =>
        linkStmt.bind(
          `${l.event_id}|${l.entity_id}|${l.role}`,
          l.event_id,
          l.entity_id,
          l.role,
          l.source,
          l.confidence,
          now,
        ),
      ),
    );
  }
  return { entities: entityRows.length, links: links.length };
}
