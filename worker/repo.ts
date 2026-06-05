// D1 access for the ontology. Rows come back with props/meta as TEXT (JSON);
// these helpers parse them into the shared object shapes.

import type {
  ObjectType,
  OntologyObject,
  OntologyLink,
  ActionLogEntry,
  Annotation,
  Entity,
  EntityRef,
  Incident,
} from "../shared/types";

function parseJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface ObjectRow {
  id: string;
  type: string;
  name: string;
  lat: number;
  lon: number;
  severity: number;
  ts: number;
  source: string | null;
  source_url: string | null;
  fetched_at: number | null;
  confidence: number | null;
  domain: string | null;
  admin0: string | null;
  admin1: string | null;
  props: string | null;
  first_seen: number;
  last_seen: number;
}

function mapObject(row: ObjectRow): OntologyObject {
  return {
    id: row.id,
    type: row.type as OntologyObject["type"],
    name: row.name,
    lat: row.lat,
    lon: row.lon,
    severity: row.severity,
    ts: row.ts,
    source: row.source,
    source_url: row.source_url ?? null,
    fetched_at: row.fetched_at ?? null,
    confidence: row.confidence ?? 1,
    domain: (row.domain ?? "other") as OntologyObject["domain"],
    admin0: row.admin0,
    admin1: row.admin1,
    props: parseJson(row.props),
    first_seen: row.first_seen,
    last_seen: row.last_seen,
  };
}

interface LinkRow {
  id: string;
  source_id: string;
  target_id: string;
  kind: string;
  basis: string | null;
  meta: string | null;
  confidence: number;
  created_ts: number;
}

function mapLink(row: LinkRow): OntologyLink {
  return {
    id: row.id,
    source_id: row.source_id,
    target_id: row.target_id,
    kind: row.kind as OntologyLink["kind"],
    basis: row.basis ?? "unspecified",
    meta: parseJson(row.meta),
    confidence: row.confidence,
    created_ts: row.created_ts,
  };
}

export async function listObjectTypes(db: D1Database): Promise<ObjectType[]> {
  const { results } = await db
    .prepare("SELECT id, label, color, geom_kind FROM object_types ORDER BY id")
    .all<ObjectType>();
  return results;
}

export async function listObjects(
  db: D1Database,
  opts: { type?: string; since?: number; limit: number },
): Promise<OntologyObject[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.type) {
    where.push("type = ?");
    binds.push(opts.type);
  }
  if (opts.since !== undefined) {
    where.push("ts >= ?");
    binds.push(opts.since);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  binds.push(opts.limit);
  const { results } = await db
    .prepare(
      `SELECT * FROM objects ${clause} ORDER BY ts DESC, id ASC LIMIT ?`,
    )
    .bind(...binds)
    .all<ObjectRow>();
  return results.map(mapObject);
}

export async function getObject(
  db: D1Database,
  id: string,
): Promise<OntologyObject | null> {
  const row = await db
    .prepare("SELECT * FROM objects WHERE id = ?")
    .bind(id)
    .first<ObjectRow>();
  return row ? mapObject(row) : null;
}

export async function listLinks(
  db: D1Database,
  opts: { limit: number },
): Promise<OntologyLink[]> {
  const { results } = await db
    .prepare("SELECT * FROM links ORDER BY created_ts DESC LIMIT ?")
    .bind(opts.limit)
    .all<LinkRow>();
  return results.map(mapLink);
}

export async function getState(
  db: D1Database,
  id: string,
): Promise<{ watch: number; flag: number }> {
  const { results } = await db
    .prepare("SELECT key, value FROM state WHERE object_id = ?")
    .bind(id)
    .all<{ key: string; value: number }>();
  const state = { watch: 0, flag: 0 };
  for (const r of results) {
    if (r.key === "watch") state.watch = r.value;
    if (r.key === "flag") state.flag = r.value;
  }
  return state;
}

export async function getAnnotations(
  db: D1Database,
  id: string,
): Promise<Annotation[]> {
  const { results } = await db
    .prepare(
      "SELECT id, object_id, text, actor, ts FROM annotations WHERE object_id = ? ORDER BY ts DESC",
    )
    .bind(id)
    .all<Annotation>();
  return results;
}

// Entities this event resolves to (Stage C).
export async function getObjectEntities(
  db: D1Database,
  eventId: string,
): Promise<EntityRef[]> {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.type, e.canonical_name, e.wikidata_qid, e.admin0,
              e.geonames_id, e.lat, e.lon, e.first_seen, e.last_seen,
              el.role, el.source, el.confidence
         FROM entity_links el
         JOIN entities e ON e.id = el.entity_id
        WHERE el.event_id = ?`,
    )
    .bind(eventId)
    .all<Entity & { role: string; source: string; confidence: number }>();
  return results.map((r) => ({
    entity: {
      id: r.id,
      type: r.type,
      canonical_name: r.canonical_name,
      wikidata_qid: r.wikidata_qid,
      admin0: r.admin0,
      geonames_id: r.geonames_id,
      lat: r.lat,
      lon: r.lon,
      first_seen: r.first_seen,
      last_seen: r.last_seen,
    },
    role: r.role,
    source: r.source,
    confidence: r.confidence,
  }));
}

export async function getEntity(
  db: D1Database,
  id: string,
): Promise<Entity | null> {
  return db.prepare("SELECT * FROM entities WHERE id = ?").bind(id).first<Entity>();
}

export async function getEntityEvents(
  db: D1Database,
  id: string,
  limit: number,
): Promise<OntologyObject[]> {
  const { results } = await db
    .prepare(
      `SELECT o.* FROM entity_links el JOIN objects o ON o.id = el.event_id
        WHERE el.entity_id = ? ORDER BY o.ts DESC LIMIT ?`,
    )
    .bind(id, limit)
    .all<ObjectRow>();
  return results.map(mapObject);
}

export async function listIncidents(
  db: D1Database,
  limit: number,
): Promise<Incident[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM incidents ORDER BY member_count DESC, t_end DESC LIMIT ?",
    )
    .bind(limit)
    .all<Incident>();
  return results;
}

export async function getIncident(
  db: D1Database,
  id: string,
): Promise<Incident | null> {
  return db.prepare("SELECT * FROM incidents WHERE id = ?").bind(id).first<Incident>();
}

export async function getIncidentMembers(
  db: D1Database,
  id: string,
): Promise<OntologyObject[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM objects WHERE incident_id = ? ORDER BY severity DESC, ts ASC",
    )
    .bind(id)
    .all<ObjectRow>();
  return results.map(mapObject);
}

export async function listActivity(
  db: D1Database,
  limit: number,
): Promise<ActionLogEntry[]> {
  const { results } = await db
    .prepare(
      "SELECT id, object_id, action, actor, payload, ts FROM actions_log ORDER BY id DESC LIMIT ?",
    )
    .bind(limit)
    .all<ActionLogEntry>();
  return results;
}

// Neighbors of an object: every object joined to it by a link in either
// direction, with the link that connects them.
export async function getNeighbors(
  db: D1Database,
  id: string,
): Promise<{ object: OntologyObject; link: OntologyLink }[]> {
  const { results } = await db
    .prepare(
      `SELECT l.id AS l_id, l.source_id, l.target_id, l.kind, l.basis, l.meta,
              l.confidence, l.created_ts,
              o.id, o.type, o.name, o.lat, o.lon, o.severity, o.ts,
              o.source, o.domain, o.admin0, o.admin1, o.props,
              o.first_seen, o.last_seen
         FROM links l
         JOIN objects o
           ON o.id = CASE WHEN l.source_id = ?1 THEN l.target_id
                          ELSE l.source_id END
        WHERE l.source_id = ?1 OR l.target_id = ?1
        ORDER BY l.confidence DESC`,
    )
    .bind(id)
    .all<ObjectRow & Record<string, unknown>>();

  return results.map((r) => ({
    object: mapObject(r as unknown as ObjectRow),
    link: mapLink({
      id: r["l_id"] as string,
      source_id: r["source_id"] as string,
      target_id: r["target_id"] as string,
      kind: r["kind"] as string,
      basis: (r["basis"] as string | null) ?? null,
      meta: (r["meta"] as string | null) ?? null,
      confidence: r["confidence"] as number,
      created_ts: r["created_ts"] as number,
    }),
  }));
}
