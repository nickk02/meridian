// Stage E part 3: semantic cross-feed corroboration. Different feeds describe the
// same real-world event in different words ("Earthquake in Japan" vs "M6.1 -
// 50km E of Honshu"). We embed significant natural-event names with Workers AI,
// store them in Vectorize, and link pairs that are semantically similar AND
// spatially/temporally close AND from DIFFERENT sources. That is corroboration
// (the same event confirmed by two independent feeds), not causation.
//
// Budget: this is NOT in the cron path. It runs only from the guarded manual
// route, so Vectorize/AI usage is bounded to explicit triggers.
//
// Finding (2026-06-05): the AI+Vectorize integration is proven working end to
// end, but on the CURRENT feeds it surfaces no links. The feeds do not cover the
// same events under different names (GDACS West Pacific cyclones have no NHC
// counterpart), and where a feed pair does describe one event (a GDACS quake and
// its USGS quake), they sit at ~0km/0h and same-type proximity clustering already
// links them. Semantic correlation will earn its keep once feeds with
// overlapping-but-differently-phrased coverage are added (e.g. a news/NLP feed).
import { haversineKm } from "./links";

const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5"; // 768-dim, matches the index
const CAND_TYPES = ["SEISMIC", "STORM", "FLOOD", "VOLCANO", "WILDFIRE", "DROUGHT"];
const CAND_CAP = 150; // events embedded per run
const SIM_MIN = 0.78; // cosine similarity floor for a match
const KM_MAX = 500; // same event: spatially close
const HR_MAX = 120; // same event: temporally close

interface Cand {
  id: string;
  type: string;
  name: string;
  lat: number;
  lon: number;
  ts: number;
  severity: number;
  source: string;
}

export interface SemanticResult {
  embedded: number;
  semanticLinks: number;
  examples: { a: string; b: string; sim: number; km: number; hours: number }[];
}

export async function correlateSemantic(
  db: D1Database,
  ai: Ai,
  vec: VectorizeIndex,
  now: number,
): Promise<SemanticResult> {
  const placeholders = CAND_TYPES.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT id, type, name, lat, lon, ts, severity, source FROM objects
        WHERE type IN (${placeholders})
          AND (source = 'gdacs' OR severity >= 2 OR type IN ('STORM','VOLCANO','DROUGHT','FLOOD'))
        ORDER BY severity DESC, ts DESC LIMIT ?`,
    )
    .bind(...CAND_TYPES, CAND_CAP)
    .all<Cand>();
  const cands = results;
  if (cands.length < 2) return { embedded: 0, semanticLinks: 0, examples: [] };

  // Embed "TYPE: name" so the type anchors the semantics.
  const texts = cands.map((c) => `${c.type}: ${c.name}`);
  const embed = (await ai.run(EMBED_MODEL, { text: texts })) as { data: number[][] };
  const vectors = embed.data;
  if (!Array.isArray(vectors) || vectors.length !== cands.length) {
    return { embedded: 0, semanticLinks: 0, examples: [] };
  }

  await vec.upsert(
    cands.map((c, i) => ({
      id: c.id,
      values: vectors[i],
      metadata: { source: c.source, type: c.type, lat: c.lat, lon: c.lon, ts: c.ts },
    })),
  );

  // Query for the cross-feed summary events (GDACS) against the index; matching
  // is bounded to those to keep query usage small.
  const byId = new Map(cands.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const links: { a: string; b: string; sim: number; km: number; hours: number }[] = [];
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (c.source !== "gdacs") continue; // query only the summary feed
    const res = await vec.query(vectors[i], { topK: 30, returnMetadata: true });
    for (const m of res.matches ?? []) {
      if (m.id === c.id || m.score < SIM_MIN) continue;
      const meta = (m.metadata ?? {}) as { source?: string; lat?: number; lon?: number; ts?: number };
      if (!meta.source || meta.source === c.source) continue; // must be a different feed
      if (meta.lat == null || meta.lon == null || meta.ts == null) continue;
      const km = haversineKm(c.lat, c.lon, meta.lat, meta.lon);
      const hours = Math.abs(c.ts - meta.ts) / 3600_000;
      if (km > KM_MAX || hours > HR_MAX) continue;
      const key = [c.id, m.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ a: c.id, b: m.id, sim: Math.round(m.score * 1000) / 1000, km: Math.round(km), hours: Math.round(hours) });
    }
  }

  // Persist as CORRELATED_WITH links with a semantic basis. Clear prior semantic
  // links first so the set is a clean rebuild.
  await db.prepare("DELETE FROM links WHERE kind = 'CORRELATED_WITH' AND basis LIKE 'semantic:%'").run();
  if (links.length > 0) {
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO links (id, source_id, target_id, kind, basis, meta, confidence, created_ts)
       VALUES (?1,?2,?3,'CORRELATED_WITH',?4,?5,?6,?7)`,
    );
    const batch = links.map((l) =>
      stmt.bind(
        `SEMANTIC|${l.a}|${l.b}`,
        l.a,
        l.b,
        `semantic:cross-feed corroboration sim=${l.sim}`,
        JSON.stringify({ sim: l.sim, km: l.km, hours: l.hours, otherName: byId.get(l.b)?.name }),
        Math.max(0.4, Math.min(0.95, l.sim)),
        now,
      ),
    );
    for (let i = 0; i < batch.length; i += 50) await db.batch(batch.slice(i, i + 50));
  }

  return { embedded: cands.length, semanticLinks: links.length, examples: links.slice(0, 8) };
}
