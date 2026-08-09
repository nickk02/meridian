# Live-updating ticker implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push newly-ingested object ids to connected browsers over a hibernating WebSocket so the existing arrival-pulse animation fires near-instantly instead of waiting for the next poll.

**Architecture:** A new Durable Object (`LiveTicker`, single global instance, same pattern as `AisCollector`) holds client WebSocket connections using the Hibernation API (`state.acceptWebSocket`, not `ws.accept()`), so the DO is not billed for idle duration between broadcasts. `runIngest` pushes new ids to it at the end of each cycle, best-effort. A client hook opens the socket and feeds ids into the existing `newIds` mechanism. Polling stays as-is, unchanged, as the backstop.

**Tech Stack:** Cloudflare Durable Objects with the WebSocket Hibernation API. No new dependencies.

## Global Constraints

- Commits authored as Nicolas Sanchez. Zero AI attribution anywhere.
- No em-dashes anywhere: code, comments, commit messages, docs.
- File a PR. Do not merge. Do not deploy (`wrangler deploy`) without explicit approval.
- "Verified" means observed proof: a live WebSocket connection observed actually receiving a push after a real ingest cycle, not source inspection.
- Use `state.acceptWebSocket(ws)` (the hibernating form) and the `webSocketMessage`/`webSocketClose`/`webSocketError` DO lifecycle methods, not `ws.accept()` plus `addEventListener`. Using the non-hibernating form defeats the entire point of this plan (the DO would be billed for duration the whole time any client is connected).
- Must not break existing polling. If this plan's WebSocket path fails for any reason (client-side or DO-side), the existing poll-based `newIds` detection must keep working exactly as it does today. This is an accelerant, not a replacement — do not remove or gate the existing polling behind this feature.
- This plan is its own PR.

---

### Task 1: The `LiveTicker` Durable Object

**Files:**
- Create: `worker/live.ts`
- Modify: `worker/index.ts` (export the class, add `LIVE` to `Env`, bind in `wrangler.jsonc`)
- Modify: `wrangler.jsonc` (new DO binding + migration entry)

**Interfaces:**
- Produces: `LiveTicker` class, exported from `worker/index.ts` like `AisCollector` already is. Route `GET /api/live` upgrades to a WebSocket served by this DO's single global instance.

- [ ] **Step 1: Write the Durable Object**

Create `worker/live.ts`:

```typescript
// Live-updating ticker: holds client WebSocket connections and relays
// newly-ingested object ids as they arrive, so the map's arrival-pulse
// animation fires near-instantly instead of waiting for the next poll.
// Uses the WebSocket Hibernation API (acceptWebSocket, not ws.accept())
// so the DO is not billed for duration while idle between broadcasts,
// the same reason AisCollector uses bounded alarm windows instead of an
// always-open connection.
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";

export class LiveTicker extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const upgrade = req.headers.get("Upgrade");
    if (upgrade !== "websocket") {
      // Internal push endpoint: the worker's ingest cycle POSTs new ids here.
      if (req.method === "POST") {
        const ids = (await req.json()) as string[];
        const sockets = this.ctx.getWebSockets();
        const payload = JSON.stringify({ newIds: ids });
        for (const ws of sockets) {
          try {
            ws.send(payload);
          } catch {
            /* client gone, hibernation cleanup handles it */
          }
        }
        return new Response("ok");
      }
      return new Response("expected websocket", { status: 400 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Required by the Hibernation API even if clients never send messages.
  async webSocketMessage(): Promise<void> {
    /* clients do not send anything meaningful; ignore */
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      /* already closing */
    }
  }

  async webSocketError(): Promise<void> {
    /* connection dropped; hibernation cleanup handles it */
  }
}
```

- [ ] **Step 2: Wire the export, Env, and route**

In `worker/index.ts`, add near the existing `export { AisCollector } from "./ais";`:

```typescript
export { LiveTicker } from "./live";
```

Add to the `Env` interface, near the `AIS` binding:

```typescript
  LIVE: DurableObjectNamespace;
```

Add the route, near the `/api/ais` route:

```typescript
app.get("/api/live", async (c) => {
  const ns = c.env.LIVE;
  if (!ns) return c.text("live ticker not bound", 503);
  const stub = ns.get(ns.idFromName("global"));
  return stub.fetch(c.req.raw);
});
```

- [ ] **Step 3: Add the binding and migration in wrangler.jsonc**

In `wrangler.jsonc`, find the existing `durable_objects` and `migrations` blocks:

```jsonc
  "durable_objects": {
    "bindings": [{ "name": "AIS", "class_name": "AisCollector" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["AisCollector"] }]
```

Replace with:

```jsonc
  "durable_objects": {
    "bindings": [
      { "name": "AIS", "class_name": "AisCollector" },
      { "name": "LIVE", "class_name": "LiveTicker" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["AisCollector"] },
    { "tag": "v2", "new_sqlite_classes": ["LiveTicker"] }
  ]
```

`LiveTicker` does not use SQLite storage itself (no `this.ctx.storage.sql` calls), but every DO class in this account so far uses the SQLite backend (see `AisCollector`), and mixing storage backends within one Worker is unnecessary complexity; `new_sqlite_classes` is the correct migration bucket for a free-tier-eligible new DO class regardless of whether it happens to touch storage.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS. `WebSocketPair`, `this.ctx.getWebSockets()`, `this.ctx.acceptWebSocket()` are part of `@cloudflare/workers-types`; if typecheck reports these as unknown, check the installed `@cloudflare/workers-types` version supports the Hibernation API types (it should, the dependency was bumped this week per `2baf597`) and report BLOCKED with the exact error if not.

- [ ] **Step 5: Commit**

```bash
git add worker/live.ts worker/index.ts wrangler.jsonc
git commit -m "Add LiveTicker Durable Object with WebSocket Hibernation API"
```

---

### Task 2: Push new ids from the ingest cycle

**Files:**
- Modify: `worker/ingest.ts`
- Modify: `worker/index.ts` (thread the `LIVE` binding into `runIngest`'s call sites)

**Interfaces:**
- Consumes: `env.LIVE` (Task 1). `runIngest`'s existing return value already has `upserted`/`sources`, but the actual NEW ids (as opposed to all ids touched this cycle) need to be tracked separately, since `runIngest` currently upserts without distinguishing new-vs-updated. Read `worker/ingest.ts`'s `upsertObjects` and the `UPSERT` SQL (`ON CONFLICT ... DO UPDATE`) to find the cleanest way to know which ids in `clean` were actually new this cycle (D1's `INSERT ... ON CONFLICT` does not report per-row which branch fired in a batch; the simplest correct approach is a `SELECT id FROM objects WHERE id IN (...)` before the upsert to know which of `clean`'s ids already existed, then the new set is `clean` minus that set).

- [ ] **Step 1: Detect new ids before upserting**

In `worker/ingest.ts`, inside `runIngest`, before the `await upsertObjects(db, clean, ran);` line, add:

```typescript
  const existingIds = new Set<string>();
  for (let i = 0; i < clean.length; i += 100) {
    const chunk = clean.slice(i, i + 100);
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT id FROM objects WHERE id IN (${placeholders})`)
      .bind(...chunk.map((o) => o.id))
      .all<{ id: string }>();
    for (const r of results) existingIds.add(r.id);
  }
  const newIds = clean.filter((o) => !existingIds.has(o.id)).map((o) => o.id);
```

- [ ] **Step 2: Push best-effort after upserting**

`runIngest`'s signature needs the `LIVE` binding threaded in. Change:

```typescript
export async function runIngest(
  db: D1Database,
  cache: KVNamespace | undefined,
  raw: R2Bucket | undefined,
  opts: { forceLinks?: boolean; keys?: Record<string, string | undefined> } = {},
): Promise<IngestResult> {
```

to:

```typescript
export async function runIngest(
  db: D1Database,
  cache: KVNamespace | undefined,
  raw: R2Bucket | undefined,
  opts: { forceLinks?: boolean; keys?: Record<string, string | undefined>; live?: DurableObjectNamespace } = {},
): Promise<IngestResult> {
```

After `await upsertObjects(db, clean, ran);`, add:

```typescript
  if (opts.live && newIds.length > 0) {
    try {
      const stub = opts.live.get(opts.live.idFromName("global"));
      await stub.fetch("https://live/push", {
        method: "POST",
        body: JSON.stringify(newIds.slice(0, 500)),
      });
    } catch {
      /* best effort; ingest must succeed even if the push fails */
    }
  }
```

Cap at 500 to avoid an oversized single push on a heavy cycle; the client only needs ids to trigger pulses for objects it can already see from the next poll anyway.

- [ ] **Step 3: Update the DO to route the push path correctly**

The DO's `fetch` in `worker/live.ts` (Task 1) already branches on `Upgrade` header vs POST; confirm the POST branch does not also require a specific path (the current stub code checks `req.method === "POST"` unconditionally in the non-upgrade branch, which is fine since `/api/live` never receives a plain POST from a browser client, only from this internal push).

- [ ] **Step 4: Thread `env.LIVE` from the two `runIngest` call sites in `worker/index.ts`**

Find `app.post("/api/ingest/run", ...)` and the `scheduled` handler at the bottom of `worker/index.ts`. Both call `runIngest(...)`; add `live: c.env.LIVE` (or `live: env.LIVE` in `scheduled`) to their `opts` argument.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/ingest.ts worker/index.ts
git commit -m "Push new object ids to the live ticker after each ingest cycle"
```

---

### Task 3: Client hook wired into the existing pulse mechanism

**Files:**
- Modify: `web/src/hooks.ts` (find `useOntology`, the existing poll-diff `newIds` source)

**Interfaces:**
- Produces: a `useLiveTicker(onNewIds: (ids: string[]) => void)` hook, or an inline `useEffect` inside `useOntology` if that reads more naturally once the real file is in front of you — read `useOntology`'s actual current implementation first (its `newIds` computation was described in earlier session notes as a poll-diff; confirm the exact mechanism before deciding whether to feed the WebSocket ids into the same state setter or a separate one that gets unioned).

- [ ] **Step 1: Read the existing `newIds` mechanism**

Before writing any code, read `web/src/hooks.ts`'s `useOntology` in full to find exactly how `newIds` is currently computed and exposed, since this task must feed into that same mechanism, not build a parallel one.

- [ ] **Step 2: Add the WebSocket hook**

Add to `web/src/hooks.ts`:

```typescript
// Opens a WebSocket to the live ticker and calls onNewIds whenever the
// worker pushes newly-ingested object ids. Best-effort and reconnecting:
// if the socket drops or never connects, polling (useOntology's existing
// diff) is the unaffected backstop, this is purely an accelerant.
export function useLiveTicker(onNewIds: (ids: string[]) => void): void {
  const handlerRef = useRef(onNewIds);
  handlerRef.current = onNewIds;

  useEffect(() => {
    let alive = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | undefined;

    const connect = () => {
      if (!alive) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${window.location.host}/api/live`);
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string) as { newIds?: string[] };
          if (Array.isArray(data.newIds) && data.newIds.length > 0) {
            handlerRef.current(data.newIds);
          }
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onclose = () => {
        if (alive) reconnectTimer = window.setTimeout(connect, 10_000);
      };
      ws.onerror = () => {
        ws?.close();
      };
    };
    connect();

    return () => {
      alive = false;
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);
}
```

- [ ] **Step 3: Wire it into `useOntology` (or `App.tsx`, whichever actually owns `newIds` state per Step 1's findings)**

Call `useLiveTicker` with a handler that merges the pushed ids into whatever state variable `newIds` already comes from, using the exact pattern already established there (read Step 1's findings before writing this; do not guess the state shape).

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks.ts
git commit -m "Wire live ticker pushes into the arrival-pulse mechanism"
```

- [ ] **Step 6: Verify live (after deploy is separately authorized)**

Open the deployed app in two browser tabs. Trigger a real ingest (`/api/ingest/run`). Confirm both tabs show an arrival pulse within a couple seconds, well before the next 60s poll would have caught it. Check the browser's WebSocket frame inspector (or `read_network_requests`) to confirm a real `newIds` frame was received, not just that a pulse happened to coincide with a poll. Report what was actually observed.
