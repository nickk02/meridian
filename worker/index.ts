import { Hono } from "hono";
import type { HealthResponse } from "../shared/types";
import {
  listObjectTypes,
  listObjects,
  listLinks,
  getObject,
  getNeighbors,
  getState,
  getAnnotations,
  listActivity,
  getObjectEntities,
  getEntity,
  getEntityEvents,
  listIncidents,
  listCrossIncidents,
  getIncident,
  getIncidentMembers,
} from "./repo";
import { runIngest } from "./ingest";
import { correlateSemantic } from "./semantic";
import { ActionBody, applyAction } from "./actions";

// The AIS collector Durable Object must be exported from the Worker entry.
export { AisCollector } from "./ais";

export interface Env {
  ASSETS: Fetcher;
  // Optional so the Worker still deploys and serves the SPA before D1/KV are
  // bound. Data routes return 503 until DB exists.
  DB?: D1Database;
  CACHE?: KVNamespace;
  RAW?: R2Bucket;
  VEC?: VectorizeIndex;
  AI?: Ai;
  // Shared secret guarding manual ingestion. Unset disables the manual route.
  INGEST_TOKEN?: string;
  // FIRMS map key for the global active-fire feed. Unset disables that feed.
  NASA_MAP_KEY?: string;
  // Live global AIS: the collector Durable Object and the aisstream.io key.
  AIS: DurableObjectNamespace;
  AISSTREAM_KEY?: string;
}

// Secrets passed to keyed adapters (FIRMS, etc.).
function adapterKeys(env: Env): Record<string, string | undefined> {
  return { NASA_MAP_KEY: env.NASA_MAP_KEY };
}

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => {
  const body: HealthResponse = { ok: true };
  return c.json(body);
});

// Guard: data routes need D1. Returns the bound DB or sends a 503.
function db(c: { env: Env }): D1Database | null {
  return c.env.DB ?? null;
}

const NO_DB = { error: "database not bound" } as const;

function clampLimit(raw: string | undefined, def: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

app.get("/api/types", async (c) => {
  const d = db(c);
  if (!d) return c.json(NO_DB, 503);
  return c.json(await listObjectTypes(d));
});

// TLE proxy for the satellite layer: fetch a curated set of orbital elements
// from CelesTrak, cache in KV (TLEs change ~daily; the client propagates live
// positions), and serve as text. Proxying handles CORS and shields CelesTrak
// from per-client load.
app.get("/api/tle", async (c) => {
  const cache = c.env.CACHE;
  const KEY = "tle:v1";
  if (cache) {
    const hit = await cache.get(KEY);
    if (hit) return c.text(hit);
  }
  const groups = ["stations", "gps-ops", "visual"];
  try {
    const parts = await Promise.all(
      groups.map((g) =>
        fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`, {
          headers: { "user-agent": "meridian-cop (github.com/nickk02/meridian)" },
        }).then((r) => (r.ok ? r.text() : "")),
      ),
    );
    const body = parts.join("\n").replace(/\r/g, "").trim();
    if (!body) return c.text("", 502);
    if (cache) await cache.put(KEY, body, { expirationTtl: 3600 });
    return c.text(body);
  } catch {
    return c.text("", 502);
  }
});

app.get("/api/objects", async (c) => {
  const d = db(c);
  if (!d) return c.json(NO_DB, 503);
  const type = c.req.query("type") || undefined;
  const sinceRaw = c.req.query("since");
  const since = sinceRaw !== undefined ? Number(sinceRaw) : undefined;
  const limit = clampLimit(c.req.query("limit"), 2000, 5000);
  const objects = await listObjects(d, {
    type,
    since: Number.isFinite(since) ? since : undefined,
    limit,
  });
  return c.json(objects);
});

app.get("/api/object/:id", async (c) => {
  const d = db(c);
  if (!d) return c.json(NO_DB, 503);
  const id = c.req.param("id");
  const object = await getObject(d, id);
  if (!object) return c.json({ error: "not found" }, 404);
  const [neighbors, state, annotations, entities] = await Promise.all([
    getNeighbors(d, id),
    getState(d, id),
    getAnnotations(d, id),
    getObjectEntities(d, id),
  ]);
  return c.json({ object, neighbors, state, annotations, entities });
});

app.get("/api/incidents", async (c) => {
  const d = db(c);
  if (!d) return c.json(NO_DB, 503);
  const limit = clampLimit(c.req.query("limit"), 100, 500);
  return c.json(await listIncidents(d, limit));
});

app.get("/api/ais", async (c) => {
  const ns = c.env.AIS;
  if (!ns) return c.json([], 200);
  // Singleton collector instance; the first hit also starts its alarm windows.
  const stub = ns.get(ns.idFromName("global"));
  const qs = c.req.query("debug") != null ? "?debug=1" : c.req.query("run") != null ? "?run=1" : "";
  const resp = await stub.fetch(`https://ais/snapshot${qs}`);
  return new Response(await resp.text(), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
});

app.get("/api/incidents/cross-domain", async (c) => {
  const d = db(c);
  if (!d) return c.json(NO_DB, 503);
  const limit = clampLimit(c.req.query("limit"), 100, 500);
  return c.json(await listCrossIncidents(d, limit));
});

app.get("/api/incident/:id", async (c) => {
  const d = db(c);
  if (!d) return c.json(NO_DB, 503);
  const incident = await getIncident(d, c.req.param("id"));
  if (!incident) return c.json({ error: "not found" }, 404);
  const members = await getIncidentMembers(d, c.req.param("id"));
  return c.json({ incident, members });
});

app.get("/api/entity/:id", async (c) => {
  const d = db(c);
  if (!d) return c.json(NO_DB, 503);
  const id = c.req.param("id");
  const entity = await getEntity(d, id);
  if (!entity) return c.json({ error: "not found" }, 404);
  const events = await getEntityEvents(d, id, 200);
  return c.json({ entity, events });
});

app.get("/api/activity", async (c) => {
  const d = db(c);
  if (!d) return c.json(NO_DB, 503);
  const limit = clampLimit(c.req.query("limit"), 50, 200);
  return c.json(await listActivity(d, limit));
});

// Audited action: write state + append to actions_log. Validated with zod.
app.post("/api/action", async (c) => {
  const d = db(c);
  if (!d) return c.json(NO_DB, 503);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const parsed = ActionBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid action", detail: parsed.error.issues }, 400);
  }
  const exists = await getObject(d, parsed.data.object_id);
  if (!exists) return c.json({ error: "object not found" }, 404);
  const result = await applyAction(d, parsed.data);
  return c.json(result);
});

app.get("/api/links", async (c) => {
  const d = db(c);
  if (!d) return c.json(NO_DB, 503);
  const limit = clampLimit(c.req.query("limit"), 5000, 20000);
  return c.json(await listLinks(d, { limit }));
});

// Manual ingest trigger. Guarded by a bearer token so the public deployment
// cannot be driven by anyone. Cron runs the same job unguarded internally.
app.post("/api/ingest/run", async (c) => {
  const token = c.env.INGEST_TOKEN;
  if (!token) return c.json({ error: "ingest disabled" }, 403);
  if (c.req.header("authorization") !== `Bearer ${token}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const d = db(c);
  if (!d) return c.json(NO_DB, 503);
  // Defaults to forcing a link rebuild; pass ?force=0 to exercise the cron gate.
  const forceLinks = c.req.query("force") !== "0";
  const result = await runIngest(d, c.env.CACHE, c.env.RAW, { forceLinks, keys: adapterKeys(c.env) });
  return c.json(result);
});

// Guarded: run semantic cross-feed corroboration (Workers AI + Vectorize). Kept
// out of the cron path so AI/Vectorize usage is bounded to explicit triggers.
app.post("/api/correlate/semantic", async (c) => {
  const token = c.env.INGEST_TOKEN;
  if (!token || c.req.header("authorization") !== `Bearer ${token}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const d = db(c);
  if (!d) return c.json(NO_DB, 503);
  if (!c.env.AI || !c.env.VEC) return c.json({ error: "AI or Vectorize not bound" }, 503);
  try {
    const result = await correlateSemantic(d, c.env.AI, c.env.VEC, Date.now());
    return c.json(result);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// Guarded: confirm a source's latest raw blob exists in R2 (Stage B gate).
app.get("/api/raw/:source", async (c) => {
  const token = c.env.INGEST_TOKEN;
  if (!token || c.req.header("authorization") !== `Bearer ${token}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  if (!c.env.RAW) return c.json({ error: "R2 not bound" }, 503);
  const key = `raw/${c.req.param("source")}/latest.json`;
  const obj = await c.env.RAW.get(key);
  if (!obj) return c.json({ error: "no blob", key }, 404);
  const text = await obj.text();
  return c.json({ key, bytes: text.length, uploaded: obj.uploaded });
});

// Unknown API routes return JSON, never the SPA shell.
app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

// Everything else is an SPA route: hand off to the static asset router.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,

  // Cron-driven ingestion. Skips cleanly if D1 is not yet bound.
  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (!env.DB) return;
    ctx.waitUntil(
      runIngest(env.DB, env.CACHE, env.RAW, { keys: adapterKeys(env) }).then(() => undefined),
    );
  },
};
