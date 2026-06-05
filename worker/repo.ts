// D1 access for the ontology. Rows come back with props/meta as TEXT (JSON);
// these helpers parse them into the shared object shapes.

import type {
  ObjectType,
  OntologyObject,
  OntologyLink,
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

// Neighbors of an object: every object joined to it by a link in either
// direction, with the link that connects them.
export async function getNeighbors(
  db: D1Database,
  id: string,
): Promise<{ object: OntologyObject; link: OntologyLink }[]> {
  const { results } = await db
    .prepare(
      `SELECT l.id AS l_id, l.source_id, l.target_id, l.kind, l.meta,
              l.confidence, l.created_ts,
              o.id, o.type, o.name, o.lat, o.lon, o.severity, o.ts,
              o.source, o.props, o.first_seen, o.last_seen
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
      meta: (r["meta"] as string | null) ?? null,
      confidence: r["confidence"] as number,
      created_ts: r["created_ts"] as number,
    }),
  }));
}
