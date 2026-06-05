import { Hono } from "hono";
import type { HealthResponse } from "../shared/types";

export interface Env {
  ASSETS: Fetcher;
  // Added at the Phase 2 operator pause, once D1 and KV exist:
  // DB: D1Database;
  // CACHE: KVNamespace;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => {
  const body: HealthResponse = { ok: true };
  return c.json(body);
});

// Unknown API routes return JSON, never the SPA shell.
app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

// Everything else is an SPA route: hand off to the static asset router, which
// serves index.html via single-page-application not_found_handling.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,

  // Scheduled ingestion is wired in Phase 3. No-op for now so the */15 cron
  // trigger has a valid handler.
  async scheduled(
    _event: ScheduledController,
    _env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    return;
  },
};
