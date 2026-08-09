# Grounded event summaries implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "SUMMARY" section in the Inspector that shows a Workers-AI-generated plain-language summary of a selected object's own structured facts, never inventing anything not already in the ontology.

**Architecture:** New worker route `GET /api/summary?id=` builds a prompt strictly from the object's existing D1 fields (name, type, severity, ts, source, props, neighbors) and calls Workers AI. New KV cache keyed by object id, invalidated on `last_seen` change. New Inspector section, same visual pattern as the existing sections.

**Tech Stack:** Workers AI (`env.AI`, already bound in `wrangler.jsonc`), same `ai.run(MODEL, {...})` call shape already used in `worker/semantic.ts` for embeddings.

## Global Constraints

- Commits authored as Nicolas Sanchez. Zero AI attribution anywhere.
- No em-dashes anywhere: code, comments, commit messages, UI copy, docs.
- File a PR. Do not merge. Do not deploy (`wrangler deploy`) without explicit approval.
- "Verified" means observed proof: a live curl against the deployed worker (Workers AI is not available in local `wrangler dev` without a remote proxy, per the existing note in `wrangler.local.jsonc` about `VEC`/`AI` forcing remote-proxy mode), a real generated summary, a real DOM check. Not source inspection.
- The grounding rule is the actual point of this feature: the prompt must only ever be built from fields already stored in D1 for this object. Never add outside context, never let the model's own general knowledge fill gaps. If a task's implementation can't cleanly guarantee that, stop and report blocked rather than shipping a summary feature that undermines this project's core "nothing is presented as more certain than it is" promise (see `CONTRIBUTING.md`'s "honesty rule").
- This plan is its own PR.

---

### Task 1: Discover the real Workers AI text-generation response shape

**Files:** None modified.

- [ ] **Step 1: Confirm the model and response shape against the real binding**

This cannot be tested via plain curl (Workers AI requires the `env.AI` binding, only available inside a deployed Worker or `wrangler dev` in remote-proxy mode). Start `npx wrangler dev` (remote mode, default `wrangler.jsonc`) and add a temporary throwaway route (or use the existing guarded `/api/correlate/semantic` pattern as a template) to call:

```typescript
const result = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
  messages: [{ role: "user", content: "Say hello in one sentence." }],
});
```

Record the exact shape of `result` (this plan assumes `{ response: string }`, matching the standard Workers AI instruct-model chat shape, but confirm against the real binding before Task 2 depends on it). Remove the throwaway route before committing anything; this is discovery only.

- [ ] **Step 2: Confirm the model name is valid**

If `@cf/meta/llama-3.1-8b-instruct` errors as an unknown model, check `https://developers.cloudflare.com/workers-ai/models/` for the current valid instruct-model catalog and use whatever the live account actually has access to. Record the working model name for Task 2.

---

### Task 2: Worker route `/api/summary`

**Files:**
- Modify: `worker/index.ts`

**Interfaces:**
- Consumes: `getObject`, `getNeighbors` from `worker/repo.ts` (both already used by `/api/object/:id`).
- Produces: `GET /api/summary?id=<object id>` returning `{ summary: string }` JSON, `404` if object not found, `503` if `AI` not bound, `500` with an error body on a Workers AI failure (never silently returning an empty string that reads as "nothing to say" when it was actually an error, same discipline already applied to `firms.ts` and the GDELT routes this session).

- [ ] **Step 1: Write the prompt builder and route**

Add to `worker/index.ts`, after the `/api/object/:id` route:

```typescript
const SUMMARY_CACHE_TTL_SECONDS = 21600;
const SUMMARY_MODEL = "@cf/meta/llama-3.1-8b-instruct"; // confirm against Task 1's finding

function buildSummaryPrompt(
  obj: OntologyObject,
  neighbors: { object: OntologyObject; link: OntologyLink }[],
): string {
  const facts = [
    `Type: ${obj.type}`,
    `Name: ${obj.name}`,
    `Severity: ${obj.severity} (1=low, 4=critical)`,
    `Time: ${new Date(obj.ts).toISOString()}`,
    `Source: ${obj.source ?? "unknown"}`,
    `Confidence: ${obj.confidence.toFixed(2)}`,
  ];
  if (obj.props && Object.keys(obj.props).length > 0) {
    facts.push(`Properties: ${JSON.stringify(obj.props)}`);
  }
  if (neighbors.length > 0) {
    facts.push(
      `Related events: ${neighbors
        .slice(0, 5)
        .map((n) => `${n.object.name} (${n.link.kind})`)
        .join(", ")}`,
    );
  }
  return (
    "Summarize the following event facts in 2 to 3 plain sentences for a general reader. " +
    "Use ONLY the facts given below. Do not add any detail, cause, count, or outcome not " +
    "explicitly present in these facts. If the facts are sparse, keep the summary short " +
    "rather than filling gaps.\n\n" +
    facts.join("\n")
  );
}

app.get("/api/summary", async (c) => {
  const d = db(c);
  if (!d) return c.json(NO_DB, 503);
  const id = c.req.query("id");
  if (!id) return c.json({ error: "missing id" }, 400);
  if (!c.env.AI) return c.json({ error: "AI not bound" }, 503);

  const cache = c.env.CACHE;
  const key = `summary:${id}`;
  const obj = await getObject(d, id);
  if (!obj) return c.json({ error: "not found" }, 404);

  if (cache) {
    const hit = await cache.get(key);
    if (hit) {
      const parsed = JSON.parse(hit) as { summary: string; last_seen: number };
      if (parsed.last_seen === obj.last_seen) return c.json({ summary: parsed.summary });
    }
  }

  const neighbors = await getNeighbors(d, id);
  const prompt = buildSummaryPrompt(obj, neighbors);
  try {
    const result = (await c.env.AI.run(SUMMARY_MODEL, {
      messages: [{ role: "user", content: prompt }],
    })) as { response?: string };
    const summary = (result.response ?? "").trim();
    if (!summary) return c.json({ error: "empty response from model" }, 500);
    if (cache) {
      await cache.put(
        key,
        JSON.stringify({ summary, last_seen: obj.last_seen }),
        { expirationTtl: SUMMARY_CACHE_TTL_SECONDS },
      );
    }
    return c.json({ summary });
  } catch (e) {
    return c.json({ error: `Workers AI failed: ${String(e)}` }, 500);
  }
});
```

Check `OntologyObject` actually has a `last_seen` field (confirm in `shared/types.ts`; if the field name differs, use the real one, this is the cache-invalidation key). Check `OntologyLink` is already imported in `worker/index.ts` (it likely needs adding to the existing type imports at the top of the file).

- [ ] **Step 2: Adjust the model name and response field per Task 1's findings**

If Task 1 found a different model name or response shape, update `SUMMARY_MODEL` and the `result.response` access accordingly.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Verify against the deployed worker**

Workers AI needs the real binding. Deploy is gated on explicit approval (do not deploy without asking), so this step's live verification happens once deploy is authorized separately; note that gate here rather than skipping the verification requirement.

- [ ] **Step 5: Commit**

```bash
git add worker/index.ts
git commit -m "Add GET /api/summary worker route using Workers AI"
```

---

### Task 3: Client hook and API method

**Files:**
- Modify: `web/src/api.ts`
- Modify: `web/src/hooks.ts`

**Interfaces:**
- Produces: `api.summary(id: string): Promise<{ summary: string }>`, `useSummary(id: string | null): { summary: string | null; loading: boolean }` following the exact shape of `useRelatedNews` if that hook exists in this working tree (it does not: the Inspector-news plan never got past its blocked discovery task, so there is no `useRelatedNews` to copy from; build this fresh following `useObjectDetail`'s shape instead, same file).

- [ ] **Step 1: Add the API method**

In `web/src/api.ts`, add to the `api` object:

```typescript
  summary: (id: string) => getJson<{ summary: string }>(`/api/summary?id=${encodeURIComponent(id)}`),
```

- [ ] **Step 2: Add the hook**

In `web/src/hooks.ts`, add:

```typescript
// Fetches the grounded AI summary for the selected object. Separate from
// useObjectDetail so a slow or failed summary never blocks the rest of the
// Inspector from rendering.
export function useSummary(id: string | null): { summary: string | null; loading: boolean } {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!id) {
      setSummary(null);
      return;
    }
    setLoading(true);
    api
      .summary(id)
      .then((d) => {
        if (alive.current) setSummary(d.summary);
      })
      .catch(() => {
        if (alive.current) setSummary(null);
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
    };
  }, [id]);

  return { summary, loading };
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/api.ts web/src/hooks.ts
git commit -m "Add useSummary hook and api.summary client method"
```

---

### Task 4: SUMMARY section in the Inspector

**Files:**
- Modify: `web/src/components/Inspector.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: `useSummary(selectedId)` from Task 3.

- [ ] **Step 1: Add the hook call and section**

In `web/src/components/Inspector.tsx`, add `useSummary` to the import from `"../hooks"`.

Add the hook call alongside `useObjectDetail`:

```typescript
  const { summary, loading: summaryLoading } = useSummary(selectedId);
```

Add a new section directly after the tags block (`detail.state.flag === 1 && (...)`), before the `ButtonGroup`:

```typescript
          <div className="mer-sub">SUMMARY</div>
          {summaryLoading ? (
            <div className="mer-faint">Generating...</div>
          ) : summary ? (
            <div className="mer-summary">
              <p>{summary}</p>
              <span className="mer-summary-tag mer-mono">AI-GENERATED, GROUNDED IN THIS OBJECT'S DATA ONLY</span>
            </div>
          ) : (
            <div className="mer-faint">No summary available.</div>
          )}
```

The disclosure tag is not optional decoration: per this plan's Global Constraints, the summary must never be presented as an independent source, only as commentary on the object's own already-shown data.

- [ ] **Step 2: Add the CSS**

In `web/src/styles.css`, near the other section styles (search for `.mer-neighbors` to find the right neighborhood), add:

```css
.mer-summary { padding: 8px; border: 1px solid var(--mer-border); border-radius: 2px; }
.mer-summary p { font-size: 12px; line-height: 1.4; margin: 0 0 6px; color: var(--mer-text); }
.mer-summary-tag { font-size: 8px; letter-spacing: 0.1em; color: var(--mer-text-dim); }
```

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Inspector.tsx web/src/styles.css
git commit -m "Add SUMMARY section to the Inspector"
```

- [ ] **Step 5: Verify live (after deploy is separately authorized)**

Click a real object, confirm a real generated summary appears with the disclosure tag, confirm it does not mention any fact not visible elsewhere in the same Inspector panel (spot-check by reading both side by side). Report the actual generated text for at least one object.
