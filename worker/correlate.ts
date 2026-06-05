// Stage E part 1: spatiotemporal incident clustering (ST-DBSCAN). Clusters are
// formed PER TYPE, so each incident is one phenomenon: a quake swarm, a wildfire
// complex, or a single storm reported by multiple feeds. Members are linked to
// the incident anchor with a CORRELATED_WITH link carrying its basis and
// confidence. This is correlation (co-occurrence), never causation.

import { haversineKm } from "./links";

interface EvtPt {
  id: string;
  type: string;
  domain: string;
  name: string;
  lat: number;
  lon: number;
  ts: number;
  severity: number;
}

interface TypeParam {
  epsKm: number;
  epsHr: number;
  minPts: number; // including the point itself
}

// Per-type space/time scale. Only clustered for SWARM/COMPLEX/OUTBREAK types
// where spatial proximity genuinely means "related": a quake swarm, a wildfire
// complex, a flood, a severe-weather outbreak. NAMED-DISTINCT-OBJECT types
// (STORM, ICE, VOLCANO) are excluded, distinct cyclones/icebergs/volcanoes near
// each other are not one incident; multi-feed dedup of those belongs in entity
// resolution by name.
const TYPE_PARAMS: Record<string, TypeParam> = {
  SEISMIC: { epsKm: 150, epsHr: 24, minPts: 3 },
  WILDFIRE: { epsKm: 60, epsHr: 168, minPts: 3 },
  FLOOD: { epsKm: 150, epsHr: 120, minPts: 3 },
  ALERT: { epsKm: 100, epsHr: 12, minPts: 3 },
};

function neighbors(pts: EvtPt[], i: number, p: TypeParam): number[] {
  const a = pts[i];
  const epsMs = p.epsHr * 3600_000;
  const out: number[] = [];
  for (let j = 0; j < pts.length; j++) {
    if (i === j) continue;
    const b = pts[j];
    if (Math.abs(a.ts - b.ts) > epsMs) continue;
    if (haversineKm(a.lat, a.lon, b.lat, b.lon) > p.epsKm) continue;
    out.push(j);
  }
  return out;
}

// Returns cluster label per point (-1 = noise).
function stDbscan(pts: EvtPt[], p: TypeParam): number[] {
  const UNVISITED = -2;
  const NOISE = -1;
  const labels = new Array(pts.length).fill(UNVISITED);
  let cluster = -1;
  for (let i = 0; i < pts.length; i++) {
    if (labels[i] !== UNVISITED) continue;
    const nb = neighbors(pts, i, p);
    if (nb.length + 1 < p.minPts) {
      labels[i] = NOISE;
      continue;
    }
    cluster++;
    labels[i] = cluster;
    const queue = [...nb];
    while (queue.length) {
      const j = queue.shift() as number;
      if (labels[j] === NOISE) labels[j] = cluster;
      if (labels[j] !== UNVISITED) continue;
      labels[j] = cluster;
      const nb2 = neighbors(pts, j, p);
      if (nb2.length + 1 >= p.minPts) for (const k of nb2) queue.push(k);
    }
  }
  return labels;
}

export interface Incident {
  id: string;
  label: string;
  domain: string;
  centroid_lat: number;
  centroid_lon: number;
  t_start: number;
  t_end: number;
  member_count: number;
  severity_max: number;
  memberIds: string[];
  anchorId: string;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// Pure clustering: events -> incidents. Tested without a database.
export function computeIncidents(events: EvtPt[]): Incident[] {
  const byType = new Map<string, EvtPt[]>();
  for (const e of events) {
    if (!TYPE_PARAMS[e.type]) continue;
    // Prescribed burns are planned, not incidents.
    if (e.type === "WILDFIRE" && /prescribed|\brx[\s-]/i.test(e.name)) continue;
    (byType.get(e.type) ?? byType.set(e.type, []).get(e.type)!).push(e);
  }

  const incidents: Incident[] = [];
  for (const [type, pts] of byType) {
    const param = TYPE_PARAMS[type];
    const labels = stDbscan(pts, param);
    const clusters = new Map<number, EvtPt[]>();
    for (let i = 0; i < pts.length; i++) {
      if (labels[i] < 0) continue;
      (clusters.get(labels[i]) ?? clusters.set(labels[i], []).get(labels[i])!).push(pts[i]);
    }
    for (const members of clusters.values()) {
      // Anchor = highest severity, then earliest.
      const anchor = [...members].sort(
        (a, b) => b.severity - a.severity || a.ts - b.ts,
      )[0];
      const lat = round(members.reduce((s, m) => s + m.lat, 0) / members.length, 4);
      const lon = round(members.reduce((s, m) => s + m.lon, 0) / members.length, 4);
      incidents.push({
        id: `INC-${type}-${anchor.id}`,
        label: `${type[0] + type.slice(1).toLowerCase()} cluster: ${anchor.name} +${members.length - 1}`,
        domain: anchor.domain,
        centroid_lat: lat,
        centroid_lon: lon,
        t_start: Math.min(...members.map((m) => m.ts)),
        t_end: Math.max(...members.map((m) => m.ts)),
        member_count: members.length,
        severity_max: Math.max(...members.map((m) => m.severity)),
        memberIds: members.map((m) => m.id),
        anchorId: anchor.id,
      });
    }
  }
  return incidents;
}

export async function correlate(
  db: D1Database,
  now: number,
): Promise<{ incidents: number; correlatedLinks: number }> {
  const { results } = await db
    .prepare(
      `SELECT id, type, domain, name, lat, lon, ts, severity FROM objects
        WHERE type IN ('SEISMIC','WILDFIRE','FLOOD','ALERT')`,
    )
    .all<EvtPt>();
  const incidents = computeIncidents(results);

  // Full rebuild: clear prior assignments and correlated links.
  await db.prepare("UPDATE objects SET incident_id = NULL WHERE incident_id IS NOT NULL").run();
  await db.prepare("DELETE FROM incidents").run();
  await db.prepare("DELETE FROM links WHERE kind = 'CORRELATED_WITH'").run();
  if (incidents.length === 0) return { incidents: 0, correlatedLinks: 0 };

  const byId = new Map(results.map((e) => [e.id, e]));
  const incStmt = db.prepare(
    `INSERT INTO incidents (id, label, domain, centroid_lat, centroid_lon,
       t_start, t_end, member_count, severity_max, created_ts)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
  );
  const assignStmt = db.prepare("UPDATE objects SET incident_id = ?1 WHERE id = ?2");
  const linkStmt = db.prepare(
    `INSERT OR REPLACE INTO links
       (id, source_id, target_id, kind, basis, meta, confidence, created_ts)
     VALUES (?1,?2,?3,'CORRELATED_WITH',?4,?5,?6,?7)`,
  );

  let correlatedLinks = 0;
  for (const inc of incidents) {
    await incStmt
      .bind(inc.id, inc.label, inc.domain, inc.centroid_lat, inc.centroid_lon,
        inc.t_start, inc.t_end, inc.member_count, inc.severity_max, now)
      .run();
    const batch = [];
    for (const mid of inc.memberIds) {
      batch.push(assignStmt.bind(inc.id, mid));
      if (mid === inc.anchorId) continue;
      const a = byId.get(mid)!;
      const b = byId.get(inc.anchorId)!;
      const km = haversineKm(a.lat, a.lon, b.lat, b.lon);
      const dtHr = Math.abs(a.ts - b.ts) / 3600_000;
      const conf = Math.max(0.3, round(1 - km / 1000 - dtHr / 240));
      batch.push(
        linkStmt.bind(
          `CORRELATED_WITH|${mid}|${inc.anchorId}`,
          mid,
          inc.anchorId,
          `spatiotemporal:stdbscan type=${a.type}`,
          JSON.stringify({ km: round(km, 1), hours: round(dtHr, 1), incident: inc.id }),
          conf,
          now,
        ),
      );
      correlatedLinks++;
    }
    for (let i = 0; i < batch.length; i += 50) await db.batch(batch.slice(i, i + 50));
  }
  return { incidents: incidents.length, correlatedLinks };
}
