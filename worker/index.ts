import { Hono } from "hono";
import type { HealthResponse } from "../shared/types";
import {
  listObjectTypes,
  listObjects,
  listLinks,
  getObject,
  getNeighbors,
} from "./repo";
import { runIngest } from "./ingest";

export interface Env {
  ASSETS: Fetcher;
  // Optional so the Worker still deploys and serves the SPA before D1/KV are
  // bound. Data routes return 503 until DB exists.
  DB?: D1Database;
  CACHE?: KVNamespace;
  // Shared secret guarding manual ingestion. Unset disables the manual route.
  INGEST_TOKEN?: string;
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
  const neighbors = await getNeighbors(d, id);
  return c.json({ object, neighbors });
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
  const result = await runIngest(d, c.env.CACHE);
  return c.json(result);
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
    ctx.waitUntil(runIngest(env.DB, env.CACHE).then(() => undefined));
  },
};
