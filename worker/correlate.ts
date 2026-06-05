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
  mag?: number | null; // earthquake magnitude (SEISMIC only); null for others
}

// Canonical domain per clustered type, so an incident's domain label is derived
// from what it IS, not from a possibly-stale stored domain (some USGS quakes
// linger in D1 tagged "other"). Used for the single-type incident label.
const TYPE_DOMAIN: Record<string, string> = {
  SEISMIC: "seismic",
  VOLCANO: "seismic",
  WILDFIRE: "environmental",
  FLOOD: "environmental",
  DROUGHT: "environmental",
  STORM: "environmental",
  ALERT: "environmental",
  ICE: "environmental",
};

// SEISMIC anchors must clear this magnitude, so background micro-seismicity
// (The Geysers, Permian Basin, the daily M<2 noise) cannot seed an incident.
// Aftershocks below it still join as members, collapsing a sequence into one
// line. GDACS quakes carry no mag but are disaster-level, so they pass.
const SEISMIC_MIN_MAG = 2.5;

// The clustering method's identity, used BOTH as the algorithm's name and as the
// link basis token, so the persisted basis can never drift from the method that
// actually produced it. Change the algorithm, change this, and the provenance
// follows automatically.
const CLUSTER_METHOD = "anchor-proximity";

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
  // Wider time window so a multi-day aftershock sequence collapses into ONE
  // incident; eps covers the rupture + aftershock zone. The mag floor (not eps)
  // is what kills micro-seismicity noise.
  SEISMIC: { epsKm: 50, epsHr: 72, minPts: 3 },
  WILDFIRE: { epsKm: 40, epsHr: 168, minPts: 3 },
  FLOOD: { epsKm: 60, epsHr: 120, minPts: 3 },
  ALERT: { epsKm: 60, epsHr: 12, minPts: 3 },
};

// The types that cluster, derived once from TYPE_PARAMS so the SQL fetch and the
// clustering guard can never list a different set (single source of truth).
export const CLUSTER_TYPES = Object.keys(TYPE_PARAMS);

// First index i with arr[i] >= x, over an ascending array (binary search).
function lowerBound(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// A member of an incident, with its distance and time offset FROM THE ANCHOR
// computed once here so the DB-write path never recomputes haversine.
interface IncMember {
  id: string;
  km: number;
  dtHr: number;
}

export interface Incident {
  id: string;
  type: string;
  label: string;
  domain: string;
  centroid_lat: number;
  centroid_lon: number;
  t_start: number;
  t_end: number;
  member_count: number;
  severity_max: number;
  members: IncMember[]; // includes the anchor (km 0, dtHr 0)
  anchorId: string;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// Pure clustering: events -> incidents. Tested without a database.
//
// Determinism: anchors are selected in a TOTAL order (severity desc, then ts
// asc, then id) so identical input always produces identical incidents; there
// is no tie left to iteration order. Overlap: when two candidate clusters share
// border events, the stronger anchor (processed first) claims the shared events,
// and a weaker overlapping cluster is absorbed into it rather than duplicated.
// Members are always within eps of their own anchor, so absorption never moves
// an event outside its stated proximity.
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
    const n = pts.length;
    const isSeismic = type === "SEISMIC";
    // Strength used to pick the anchor: earthquake magnitude for SEISMIC (a
    // GDACS quake has no mag but is disaster-level, so treat null as high),
    // otherwise severity. Anchor = strongest, then earliest, then id.
    const strength = (e: EvtPt) => (isSeismic ? (e.mag ?? 99) : e.severity);
    const order = pts
      .map((_, i) => i)
      .sort(
        (a, b) =>
          strength(pts[b]) - strength(pts[a]) ||
          pts[a].ts - pts[b].ts ||
          (pts[a].id < pts[b].id ? -1 : pts[a].id > pts[b].id ? 1 : 0),
      );
    // Latitude-sorted index so neighbor search scans only a latitude band of
    // width 2*eps instead of all n points (turns the per-anchor scan from O(n)
    // into O(band)). 1 deg latitude >= 110.5 km, so epsKm/110 deg is a safe,
    // slightly wide band: every true neighbor falls inside it.
    const latOrder = pts.map((_, i) => i).sort((a, b) => pts[a].lat - pts[b].lat);
    const lats = latOrder.map((i) => pts[i].lat);
    const degBand = param.epsKm / 110;
    const epsMs = param.epsHr * 3600_000;
    const taken = new Array(n).fill(false);

    for (const ai of order) {
      if (taken[ai]) continue;
      const a = pts[ai];
      const lo = lowerBound(lats, a.lat - degBand);
      const hi = lowerBound(lats, a.lat + degBand + 1e-9);
      const members: { idx: number; km: number; dtHr: number }[] = [{ idx: ai, km: 0, dtHr: 0 }];
      for (let p = lo; p < hi; p++) {
        const j = latOrder[p];
        if (j === ai || taken[j]) continue;
        const b = pts[j];
        const dt = Math.abs(a.ts - b.ts);
        if (dt > epsMs) continue;
        const km = haversineKm(a.lat, a.lon, b.lat, b.lon);
        if (km > param.epsKm) continue;
        members.push({ idx: j, km, dtHr: dt / 3600_000 });
      }
      if (members.length < param.minPts) continue; // not a cluster; anchor stays free
      const pm = members.map((m) => pts[m.idx]);
      // Magnitude floor: a seismic cluster must contain a real quake (M>=2.5, or
      // a GDACS disaster quake), else it is background micro-seismicity. The
      // anchor leaves itself free so a genuine anchor elsewhere can still use it.
      if (isSeismic && !pm.some((m) => (m.mag ?? 99) >= SEISMIC_MIN_MAG)) continue;
      for (const m of members) taken[m.idx] = true;
      incidents.push({
        id: `INC-${type}-${a.id}`,
        type,
        label: `${type[0] + type.slice(1).toLowerCase()} cluster: ${a.name} +${members.length - 1}`,
        domain: TYPE_DOMAIN[type] ?? a.domain,
        centroid_lat: round(pm.reduce((s, m) => s + m.lat, 0) / pm.length, 4),
        centroid_lon: round(pm.reduce((s, m) => s + m.lon, 0) / pm.length, 4),
        t_start: Math.min(...pm.map((m) => m.ts)),
        t_end: Math.max(...pm.map((m) => m.ts)),
        member_count: members.length,
        severity_max: Math.max(...pm.map((m) => m.severity)),
        members: members.map((m) => ({ id: pts[m.idx].id, km: round(m.km, 1), dtHr: round(m.dtHr, 1) })),
        anchorId: a.id,
      });
    }
  }
  return incidents;
}

// Cross-domain correlation: a spatiotemporal cluster that spans 2+ DOMAINS, by
// either of two plausible relationships (never naive proximity, which is
// coincidence). 1) Cross-feed: the SAME event reported by independent feeds in
// different domains (a GDACS disaster quake and the USGS seismic cluster for it)
// is real corroboration. Tight radius. 2) Cross-kind: DIFFERENT event types with
// a shared mechanism (a volcano and its quakes, a drought and the fires in it),
// gated to the co-causal whitelist. Wider radius. The human judges from the
// members and their bases.
const CROSS_SAME_KM = 120; // same-type cross-feed: the same event, close
const CROSS_KIND_KM = 250; // co-causal cross-kind: regional (a drought's fires)
const CROSS_TYPES = new Set(["STORM", "FLOOD", "ALERT", "VOLCANO", "SEISMIC", "WILDFIRE", "DROUGHT"]);

// How long the same phenomenon can be reported apart by two feeds and still be
// the same event (the disaster feed lags the detail feed; long-lived hazards
// like fires/droughts span weeks).
const SAME_TYPE_WINDOW_HR: Record<string, number> = {
  SEISMIC: 72,
  VOLCANO: 720,
  WILDFIRE: 720,
  DROUGHT: 720,
  STORM: 168,
  FLOOD: 168,
  ALERT: 48,
};

// Repair the stale "other" domain (some USGS quakes linger mislabeled) so it
// cannot manufacture a false cross-domain pair against a correctly-tagged one.
const correctedDomain = (e: EvtPt) => (e.domain === "other" ? (TYPE_DOMAIN[e.type] ?? "other") : e.domain);

// The plausible-shared-mechanism check, returning the TIME WINDOW (hours) the two
// events may be apart and still be related, or 0 if there is no mechanism. The
// window is the phenomenon's active duration: a volcano drives seismicity for
// weeks, a drought feeds fires for months, a storm's floods land within days, a
// tsunami follows its quake within hours. A flat window would either miss the
// long-lived disasters or let short-lived alerts pair with anything. (Unordered.)
function coCausalWindowHr(a: EvtPt, b: EvtPt): number {
  const has = (x: string, y: string) =>
    (a.type === x && b.type === y) || (a.type === y && b.type === x);
  if (has("VOLCANO", "SEISMIC")) return 720; // volcano active for weeks
  if (has("WILDFIRE", "DROUGHT")) return 720; // drought persists for months
  if (has("STORM", "FLOOD")) return 168; // storm and the floods it drives, days
  if (has("STORM", "ALERT") || has("FLOOD", "ALERT")) return 72; // alerts are shorter-lived
  if (has("SEISMIC", "ALERT")) {
    const alert = a.type === "ALERT" ? a : b;
    return /tsunami/i.test(alert.name) ? 12 : 0; // tsunami follows its quake within hours
  }
  return 0;
}

export interface CrossMember extends IncMember {
  name: string;
  domain: string;
  type: string;
  severity: number;
}

export interface CrossIncident {
  id: string;
  label: string;
  anchorId: string;
  centroid_lat: number;
  centroid_lon: number;
  t_start: number;
  t_end: number;
  member_count: number;
  type_count: number;
  severity_max: number;
  types: string[];
  domains: string[];
  members: CrossMember[];
}

export function computeCrossDomain(events: EvtPt[]): CrossIncident[] {
  const pts = events.filter(
    (e) => CROSS_TYPES.has(e.type) && !(e.type === "WILDFIRE" && /prescribed|\brx[\s-]/i.test(e.name)),
  );
  // Anchor strongest-first; a present GDACS disaster event (which seeds the
  // cross-feed corroborations) outranks a raw detection.
  const order = pts
    .map((_, i) => i)
    .sort(
      (a, b) =>
        pts[b].severity - pts[a].severity ||
        pts[a].ts - pts[b].ts ||
        (pts[a].id < pts[b].id ? -1 : pts[a].id > pts[b].id ? 1 : 0),
    );
  const latOrder = pts.map((_, i) => i).sort((a, b) => pts[a].lat - pts[b].lat);
  const lats = latOrder.map((i) => pts[i].lat);
  const degBand = CROSS_KIND_KM / 110;
  const taken = new Array(pts.length).fill(false);

  const out: CrossIncident[] = [];
  for (const ai of order) {
    if (taken[ai]) continue;
    const a = pts[ai];
    const lo = lowerBound(lats, a.lat - degBand);
    const hi = lowerBound(lats, a.lat + degBand + 1e-9);
    const members: { idx: number; km: number; dtHr: number }[] = [{ idx: ai, km: 0, dtHr: 0 }];
    for (let q = lo; q < hi; q++) {
      const j = latOrder[q];
      if (j === ai || taken[j]) continue;
      const b = pts[j];
      // Same type = cross-feed (tight); different type = co-causal cross-kind.
      const sameType = a.type === b.type;
      const winHr = sameType ? (SAME_TYPE_WINDOW_HR[a.type] ?? 0) : coCausalWindowHr(a, b);
      if (winHr <= 0) continue;
      const maxKm = sameType ? CROSS_SAME_KM : CROSS_KIND_KM;
      const dt = Math.abs(a.ts - b.ts);
      if (dt > winHr * 3600_000) continue;
      const km = haversineKm(a.lat, a.lon, b.lat, b.lon);
      if (km > maxKm) continue;
      members.push({ idx: j, km, dtHr: dt / 3600_000 });
    }
    if (members.length < 2) continue;
    const pmAll = members.map((m) => pts[m.idx]);
    // Must span 2+ corrected domains to be a cross-domain incident.
    if (new Set(pmAll.map(correctedDomain)).size < 2) continue;
    for (const m of members) taken[m.idx] = true;
    const pm = members.map((m) => pts[m.idx]);
    const types = [...new Set(pm.map((m) => m.type))];
    const domains = [...new Set(pm.map(correctedDomain))];
    out.push({
      id: `XINC-${a.id}`,
      label: `${a.name} + ${members.length - 1}`,
      anchorId: a.id,
      centroid_lat: round(pm.reduce((s, m) => s + m.lat, 0) / pm.length, 4),
      centroid_lon: round(pm.reduce((s, m) => s + m.lon, 0) / pm.length, 4),
      t_start: Math.min(...pm.map((m) => m.ts)),
      t_end: Math.max(...pm.map((m) => m.ts)),
      member_count: members.length,
      type_count: types.length,
      severity_max: Math.max(...pm.map((m) => m.severity)),
      types,
      domains,
      members: members.map((m) => ({
        id: pts[m.idx].id,
        name: pts[m.idx].name,
        domain: correctedDomain(pts[m.idx]),
        type: pts[m.idx].type,
        severity: pts[m.idx].severity,
        km: round(m.km, 1),
        dtHr: round(m.dtHr, 1),
      })),
    });
  }
  return out;
}

export async function correlate(
  db: D1Database,
  now: number,
): Promise<{ incidents: number; correlatedLinks: number; crossIncidents: number }> {
  // Fetch the union of types both clusterers need: same-type clustering uses
  // CLUSTER_TYPES, cross-domain uses CROSS_TYPES (which adds STORM, VOLCANO,
  // DROUGHT). Each function filters to its own set, so the superset is safe.
  const fetchTypes = [...new Set([...CLUSTER_TYPES, ...CROSS_TYPES])];
  const placeholders = fetchTypes.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT id, type, domain, name, lat, lon, ts, severity,
              json_extract(props, '$.mag') AS mag FROM objects
        WHERE type IN (${placeholders})`,
    )
    .bind(...fetchTypes)
    .all<EvtPt>();
  const incidents = computeIncidents(results);
  const cross = computeCrossDomain(results);

  // Full rebuild: clear prior assignments, correlated links, and both incident
  // tables before reinserting.
  await db.prepare("UPDATE objects SET incident_id = NULL WHERE incident_id IS NOT NULL").run();
  await db.prepare("DELETE FROM incidents").run();
  await db.prepare("DELETE FROM links WHERE kind = 'CORRELATED_WITH'").run();
  await db.prepare("DELETE FROM cross_incidents").run();

  await writeCrossIncidents(db, cross, now);
  if (incidents.length === 0) return { incidents: 0, correlatedLinks: 0, crossIncidents: cross.length };

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
    for (const m of inc.members) {
      batch.push(assignStmt.bind(inc.id, m.id));
      if (m.id === inc.anchorId) continue;
      // km and dtHr were computed during clustering (relative to the anchor); no
      // haversine recompute here.
      const conf = Math.max(0.3, round(1 - m.km / 1000 - m.dtHr / 240));
      batch.push(
        linkStmt.bind(
          `CORRELATED_WITH|${m.id}|${inc.anchorId}`,
          m.id,
          inc.anchorId,
          `spatiotemporal:${CLUSTER_METHOD} type=${inc.type}`,
          JSON.stringify({ km: m.km, hours: m.dtHr, incident: inc.id }),
          conf,
          now,
        ),
      );
      correlatedLinks++;
    }
    for (let i = 0; i < batch.length; i += 50) await db.batch(batch.slice(i, i + 50));
  }
  return { incidents: incidents.length, correlatedLinks, crossIncidents: cross.length };
}

// Persist cross-domain incidents. Self-contained rows (types/domains/members as
// JSON) read straight into the feed; the table is cleared by the caller first.
async function writeCrossIncidents(db: D1Database, cross: CrossIncident[], now: number): Promise<void> {
  if (cross.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO cross_incidents
       (id, label, anchor_id, centroid_lat, centroid_lon, t_start, t_end,
        member_count, type_count, severity_max, types, domains, members, created_ts)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)`,
  );
  const batch = cross.map((x) =>
    stmt.bind(
      x.id, x.label, x.anchorId, x.centroid_lat, x.centroid_lon, x.t_start, x.t_end,
      x.member_count, x.type_count, x.severity_max,
      JSON.stringify(x.types), JSON.stringify(x.domains), JSON.stringify(x.members), now,
    ),
  );
  for (let i = 0; i < batch.length; i += 50) await db.batch(batch.slice(i, i + 50));
}
