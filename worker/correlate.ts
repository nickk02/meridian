// Stage E part 1: spatiotemporal incident clustering. Clusters are formed PER
// TYPE, so each incident is one phenomenon: a quake swarm, a wildfire complex, a
// flood, a severe-weather outbreak.
//
// Model: anchor + direct proximity (NOT transitive density-reachability). Each
// incident is seeded by its strongest event (the anchor); every member must lie
// within epsKm AND epsHr of that anchor DIRECTLY. We deliberately avoid the
// transitive A->B->C chaining of DBSCAN: where background events are dense (The
// Geysers geothermal field, the Permian Basin injection zone, statewide micro-
// seismicity) density-reachability walks across hundreds of km of unrelated
// faults and dresses coincidence up as one incident. Direct proximity bounds
// every cluster's diameter to 2*eps by construction, and makes each member's
// stated basis literally true: it really is within X km of the anchor, not the
// far end of a chain. Members link to the anchor with a CORRELATED_WITH link
// carrying that basis and confidence. This is correlation (co-occurrence),
// never causation.

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
//
// eps is kept tight on purpose: in the anchor model a cluster's max diameter is
// 2*eps, so a tight eps is the structural guard against sprawl. SEISMIC is the
// tightest because micro-seismicity is the densest background.
const TYPE_PARAMS: Record<string, TypeParam> = {
  SEISMIC: { epsKm: 35, epsHr: 24, minPts: 4 },
  WILDFIRE: { epsKm: 40, epsHr: 168, minPts: 3 },
  FLOOD: { epsKm: 60, epsHr: 120, minPts: 3 },
  ALERT: { epsKm: 60, epsHr: 12, minPts: 3 },
};

// Events within eps km AND eps hr of the anchor, by DIRECT distance. No
// transitivity: this is what keeps a cluster tight around its anchor.
function directMembers(pts: EvtPt[], anchorIdx: number, taken: boolean[], p: TypeParam): number[] {
  const a = pts[anchorIdx];
  const epsMs = p.epsHr * 3600_000;
  const out: number[] = [anchorIdx];
  for (let j = 0; j < pts.length; j++) {
    if (j === anchorIdx || taken[j]) continue;
    const b = pts[j];
    if (Math.abs(a.ts - b.ts) > epsMs) continue;
    if (haversineKm(a.lat, a.lon, b.lat, b.lon) > p.epsKm) continue;
    out.push(j);
  }
  return out;
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
    // Process strongest-first so the most significant event anchors its cluster,
    // then earliest as a stable tiebreak. order = indices into pts.
    const order = pts
      .map((_, i) => i)
      .sort((a, b) => pts[b].severity - pts[a].severity || pts[a].ts - pts[b].ts);
    const taken = new Array(pts.length).fill(false);

    for (const ai of order) {
      if (taken[ai]) continue;
      const idx = directMembers(pts, ai, taken, param);
      if (idx.length < param.minPts) continue; // not a cluster; anchor stays free as a potential member
      for (const k of idx) taken[k] = true;
      const members = idx.map((k) => pts[k]);
      const anchor = pts[ai];
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
