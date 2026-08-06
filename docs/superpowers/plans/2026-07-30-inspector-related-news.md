# Inspector related news implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "RELATED NEWS" section to the existing Inspector that shows real news articles for whatever ontology object is selected, sourced from GDELT DOC 2.0, with a cache keyed to be shared across nearby objects rather than per object.

**Architecture:** A new worker route (`GET /api/news?id=`) builds a query from the object's country (already stored as `admin0`) and domain, proxies GDELT DOC 2.0, and caches the result in KV keyed by country/domain/day rather than object id. A new hook fetches it; a new Inspector section renders it. GDELT-origin objects never reach this path, because the GDELT overlay plan keeps GDELT out of D1 entirely, so that edge case does not need handling here.

**Tech Stack:** Hono (worker route), the existing `worker/geo/reverse.ts` `countryAt` precedent (reused as a pattern, not called again, since `admin0` is already stored on every object), React hook following the `useObjectDetail` shape already in `web/src/hooks.ts`.

## Global Constraints

- Commits authored as Nicolas Sanchez. Zero AI attribution anywhere.
- No em-dashes anywhere: code, comments, commit messages, UI copy, docs.
- File a PR. Do not merge. Do not deploy (`wrangler deploy`) without explicit approval.
- "Verified" means observed proof: a live curl result, a real DOM measurement, a real KV read. Not source inspection, not a green typecheck alone.
- No longer depends on the GDELT overlay plan. That plan is deferred (GEO 2.0 is dead, see `docs/superpowers/specs/2026-07-30-gdelt-worldwide-overlay-design.md`), so its `/api/gdelt` route does not exist. This plan's Task 2 implements its own 429/`Retry-After`/non-200 handling directly (the plan's code already shows it in full); it does not reuse anything from the other plan.
- If GDELT DOC 2.0 does not behave as this plan expects once actually queried, stop and report blocked. Do not substitute a different news source and call the task done.
- Verify against `npx wrangler dev` (remote mode, default `wrangler.jsonc`), not the production URL.
- This plan is its own PR. Do not combine with the GDELT overlay or layout readability plans.

---

### Task 1: Discover the real GDELT DOC 2.0 query and response shape

**Files:** None modified. Discovery output is required input to Task 2.

- [ ] **Step 1: Query the live endpoint with a realistic query**

Run:

```bash
curl -s "https://api.gdeltproject.org/api/v2/doc/doc?query=earthquake%20Japan&mode=artlist&format=json&maxrecords=5&sort=hybridrel" | head -c 2000
```

Expected: a JSON object. Record the actual top-level key holding the article array (this plan is written against the hypothesis that it is `articles`, each with at least `url`, `title`, `seendate`, `domain` fields, but that has not been confirmed against a live response as of this plan being written) and confirm or correct it here before writing Task 2.

- [ ] **Step 2: Confirm the date-range parameters**

Run:

```bash
curl -s "https://api.gdeltproject.org/api/v2/doc/doc?query=earthquake&mode=artlist&format=json&maxrecords=5&startdatetime=20260701000000&enddatetime=20260710000000" | head -c 1000
```

Expected: results scoped to that window (or a clear error if the parameter names are wrong). Record whether `startdatetime`/`enddatetime` in `YYYYMMDDHHMMSS` format is accepted, since Task 2's code is written against that hypothesis.

- [ ] **Step 3: Confirm empty-result behavior**

Run a query expected to return nothing, e.g. a nonsense keyword combination:

```bash
curl -s "https://api.gdeltproject.org/api/v2/doc/doc?query=zzqxnonsensequery9999&mode=artlist&format=json&maxrecords=5"
```

Expected: record whether this returns an empty `articles: []`, a 200 with an error-shaped body, or something else. Task 2's route needs to tell "no articles" apart from "GDELT returned something unparseable" the same way `/api/gdelt` already does for GEO 2.0.

- [ ] **Step 4: Record findings**

Write the confirmed response shape and parameter behavior into the PR description before starting Task 2. If DOC 2.0 does not accept a plain natural-language query combined with a date range in the way this plan assumes, stop and report blocked.

---

### Task 2: Worker route `/api/news`

**Files:**
- Modify: `worker/index.ts`

**Interfaces:**
- Consumes: `getObject(db, id)` from `worker/repo.ts` (existing, returns `Promise<OntologyObject | null>`). `OntologyObject.admin0: string | null`, `.domain: Domain`, `.name: string`, `.ts: number` (all existing fields, confirmed in `shared/types.ts`).
- Produces: `GET /api/news?id=<object id>` returning `{ articles: { title: string; url: string; source: string; seendate: string }[] }` as JSON, `200` with an empty `articles` array when nothing is found, `404` if the object id does not exist, `502`/`429` on upstream failure using the same shape `/api/gdelt` already returns.

- [ ] **Step 1: Add the country name table**

In `worker/index.ts`, add near the top of the file, after the `Env` interface:

```typescript
// ISO3 to display name, covering the country codes actually present in
// production admin0 data as of 2026-07-30 (verified via a live D1 query
// against the deployed database, not a full 195-country guess). A country
// not in this table simply drops out of the news query's geographic term
// rather than guessing a name; see buildNewsQuery.
const COUNTRY_NAME: Record<string, string> = {
  USA: "United States", DEU: "Germany", ESP: "Spain", CHN: "China",
  RUS: "Russia", FIN: "Finland", IDN: "Indonesia", NZL: "New Zealand",
  CHL: "Chile", JPN: "Japan", PHL: "Philippines", ATA: "Antarctica",
  CAN: "Canada", FRA: "France", PER: "Peru", ARG: "Argentina",
  IRN: "Iran", NOR: "Norway", PRI: "Puerto Rico", BRA: "Brazil",
  ETH: "Ethiopia", MEX: "Mexico", PNG: "Papua New Guinea", THA: "Thailand",
  TJK: "Tajikistan", AFG: "Afghanistan", AUS: "Australia", JOR: "Jordan",
  KOR: "South Korea", LVA: "Latvia", MDG: "Madagascar", MNG: "Mongolia",
  NAM: "Namibia", AGO: "Angola", ALB: "Albania", CRI: "Costa Rica",
  GTM: "Guatemala", IRQ: "Iraq", ISL: "Iceland", ISR: "Israel",
  KAZ: "Kazakhstan", KEN: "Kenya", MMR: "Myanmar", MNP: "Northern Mariana Islands",
  OMN: "Oman", POL: "Poland", PRT: "Portugal", SAU: "Saudi Arabia",
  SLB: "Solomon Islands", TUN: "Tunisia", TUR: "Turkiye", VNM: "Vietnam",
  ZAF: "South Africa",
};

// A keyword per domain to steer the news query toward the right kind of
// article, alongside the geographic term and the object's own name.
const DOMAIN_KEYWORD: Record<string, string> = {
  seismic: "earthquake",
  environmental: "weather",
  disaster: "disaster",
  space: "space",
  energy: "energy",
  health: "health",
  transport: "transport",
  civic: "unrest",
  political: "politics",
  conflict: "conflict",
  maritime: "maritime",
  aviation: "aviation",
  other: "",
};
```

If Task 1 found that the object's own `name` field (already available) works better combined differently, or that certain domain keywords produce poor results, adjust this table, but keep it a real, complete table, not a partial one with gaps silently falling through to nothing.

- [ ] **Step 2: Add the query-building and route logic**

Add after the `COUNTRY_NAME`/`DOMAIN_KEYWORD` tables:

```typescript
const NEWS_WINDOW_DAYS = 3;
const NEWS_CACHE_TTL_SECONDS = 3600;

function gdeltDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}000000`;
}

function buildNewsQuery(obj: { name: string; domain: string; admin0: string | null }): string {
  const country = obj.admin0 ? COUNTRY_NAME[obj.admin0] : undefined;
  const keyword = DOMAIN_KEYWORD[obj.domain] ?? "";
  return [country, keyword, obj.name].filter(Boolean).join(" ").trim();
}

// Cache key shares an entry across every object in the same country, domain,
// and day, instead of one entry per object id (roughly 1,700 objects today
// and growing), so repeat Inspector clicks do not each burn a fresh GDELT
// call. Falls back to a coarse lat/lon grid cell (same rounding approach
// firms.ts already uses) when admin0 is null, e.g. an ocean event.
function newsCacheKey(obj: { domain: string; admin0: string | null; ts: number; lat: number; lon: number }): string {
  const geo = obj.admin0 ?? `${(Math.round(obj.lat / 5) * 5).toFixed(0)},${(Math.round(obj.lon / 5) * 5).toFixed(0)}`;
  const day = Math.floor(obj.ts / 86_400_000);
  return `news:${geo}:${obj.domain}:${day}`;
}
```

Then add the route, after the `/api/gdelt` route added by the GDELT overlay plan:

```typescript
app.get("/api/news", async (c) => {
  const d = db(c);
  if (!d) return c.json(NO_DB, 503);
  const id = c.req.query("id");
  if (!id) return c.json({ error: "missing id" }, 400);
  const obj = await getObject(d, id);
  if (!obj) return c.json({ error: "not found" }, 404);

  const cache = c.env.CACHE;
  const key = newsCacheKey(obj);
  if (cache) {
    const hit = await cache.get(key);
    if (hit) return c.text(hit, 200, { "content-type": "application/json" });
  }

  const query = buildNewsQuery(obj);
  const start = gdeltDateTime(obj.ts - NEWS_WINDOW_DAYS * 86_400_000);
  const end = gdeltDateTime(obj.ts + NEWS_WINDOW_DAYS * 86_400_000);
  const url =
    `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}` +
    `&mode=artlist&format=json&maxrecords=8&sort=hybridrel&startdatetime=${start}&enddatetime=${end}`;

  let resp: Response;
  try {
    resp = await fetch(url, { headers: { "user-agent": "meridian-cop (github.com/nickk02/meridian)" } });
  } catch (e) {
    return c.json({ error: `GDELT DOC fetch failed: ${String(e)}` }, 502);
  }
  if (resp.status === 429) {
    const retryAfter = resp.headers.get("retry-after");
    return c.json({ error: "GDELT rate limited", retryAfter: retryAfter ?? null }, 429);
  }
  if (!resp.ok) {
    return c.json({ error: `GDELT DOC returned ${resp.status}: ${await resp.text()}` }, 502);
  }
  const text = await resp.text();
  let parsed: { articles?: { url?: string; title?: string; seendate?: string; domain?: string }[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    return c.json({ error: `GDELT DOC returned non-JSON body: ${text.slice(0, 200)}` }, 502);
  }
  const articles = (parsed.articles ?? [])
    .filter((a) => a.url && a.title)
    .map((a) => ({
      title: a.title as string,
      url: a.url as string,
      source: a.domain ?? "unknown",
      seendate: a.seendate ?? "",
    }));
  const body = JSON.stringify({ articles });
  if (cache) await cache.put(key, body, { expirationTtl: NEWS_CACHE_TTL_SECONDS });
  return c.text(body, 200, { "content-type": "application/json" });
});
```

Add `getObject` to the existing import from `./repo` at the top of `worker/index.ts` if it is not already imported (it is: confirm the existing `import { ... getObject ... } from "./repo"` line already lists it, since `/api/object/:id` already uses it; do not add a duplicate import).

If Task 1 found a different articles-array key name or a different date-parameter format, adjust `parsed.articles` and `gdeltDateTime`'s output format to match what was actually observed.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Verify against a real object id**

Start `npx wrangler dev` (remote mode). Get a real object id from the live data:

```bash
curl -s "http://localhost:8787/api/objects?limit=1" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d)[0].id))"
```

Then:

```bash
curl -s "http://localhost:8787/api/news?id=<the id printed above>"
```

Expected: a real JSON response with an `articles` array (populated or genuinely empty, either is fine as long as it is not an error). Report the actual output.

- [ ] **Step 5: Verify the cache key groups by country/domain/day, not object id**

Pick two different real object ids that share the same `admin0` and `domain` (query D1 or `/api/objects` to find a pair; USA has the most objects in production as of this plan being written, so a pair of USA objects with the same domain is the likely easiest source). Call `/api/news` for both, then check whether they produced the same KV key (temporarily log the computed key server-side if there is no other way to observe it, and remove the log before commit):

```bash
curl -s "http://localhost:8787/api/news?id=<first id>" > /tmp/a.json
curl -s "http://localhost:8787/api/news?id=<second id>" > /tmp/b.json
diff /tmp/a.json /tmp/b.json
```

Expected: identical output (both served from the same cache entry on the second call, or both hitting GDELT fresh with an equivalent query on the first). Report what was actually observed, including whether the two objects' computed cache keys were confirmed identical.

- [ ] **Step 6: Commit**

```bash
git add worker/index.ts
git commit -m "Add GET /api/news worker route for Inspector related news"
```

---

### Task 3: Client hook and API method

**Files:**
- Modify: `web/src/api.ts`
- Modify: `web/src/hooks.ts`

**Interfaces:**
- Consumes: `GET /api/news?id=` (Task 2).
- Produces: `api.news(id: string): Promise<{ articles: NewsArticle[] }>` in `web/src/api.ts`. `useRelatedNews(id: string | null): { articles: NewsArticle[]; loading: boolean }` in `web/src/hooks.ts`, following the same shape as `useObjectDetail`.

- [ ] **Step 1: Add the API method and type**

In `web/src/api.ts`, add near the top:

```typescript
export interface NewsArticle {
  title: string;
  url: string;
  source: string;
  seendate: string;
}
```

Then add to the `api` object, after `activity`:

```typescript
  news: (id: string) => getJson<{ articles: NewsArticle[] }>(`/api/news?id=${encodeURIComponent(id)}`),
```

- [ ] **Step 2: Add the hook**

In `web/src/hooks.ts`, add after `useObjectDetail`:

```typescript
// Fetches related news for the selected object. Separate from
// useObjectDetail so a slow or failed news lookup never blocks the rest of
// the Inspector from rendering.
export function useRelatedNews(id: string | null): {
  articles: import("./api").NewsArticle[];
  loading: boolean;
} {
  const [articles, setArticles] = useState<import("./api").NewsArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!id) {
      setArticles([]);
      return;
    }
    setLoading(true);
    api
      .news(id)
      .then((d) => {
        if (alive.current) setArticles(d.articles);
      })
      .catch(() => {
        if (alive.current) setArticles([]);
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
    };
  }, [id]);

  return { articles, loading };
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/api.ts web/src/hooks.ts
git commit -m "Add useRelatedNews hook and api.news client method"
```

---

### Task 4: RELATED NEWS section in the Inspector

**Files:**
- Modify: `web/src/components/Inspector.tsx`
- Modify: `web/src/styles.css` (new section styling, following the existing `.mer-neighbors`/`.mer-neighbor` pattern)

**Interfaces:**
- Consumes: `useRelatedNews(selectedId)` from `web/src/hooks.ts` (Task 3).

- [ ] **Step 1: Add the hook call and section**

In `web/src/components/Inspector.tsx`, find the import line:

```typescript
import { useObjectDetail } from "../hooks";
```

Replace with:

```typescript
import { useObjectDetail, useRelatedNews } from "../hooks";
```

Find:

```typescript
export function Inspector({ selectedId, typeMap, onSelect, onActed }: Props) {
  const { detail, refresh } = useObjectDetail(selectedId);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
```

Replace with:

```typescript
export function Inspector({ selectedId, typeMap, onSelect, onActed }: Props) {
  const { detail, refresh } = useObjectDetail(selectedId);
  const { articles, loading: newsLoading } = useRelatedNews(selectedId);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
```

Find the "LINKED OBJECTS" section, which is the last content block before "ANNOTATIONS":

```typescript
          <div className="mer-sub">LINKED OBJECTS ({detail.neighbors.length})</div>
          {detail.neighbors.length === 0 ? (
            <div className="mer-faint">No derived links.</div>
          ) : (
            <div className="mer-neighbors">
              {detail.neighbors.slice(0, 40).map((n) => (
                <button
                  key={n.object.id}
                  className="mer-neighbor"
                  onClick={() => onSelect(n.object.id)}
                  title={`basis: ${n.link.basis}`}
                >
                  <span className="mer-swatch" style={{ background: typeMap.get(n.object.type)?.color }} />
                  <span className="mer-neighbor-name">{n.object.name}</span>
                  <Tag minimal className="mer-mono mer-neighbor-kind">
                    {n.link.kind === "PROXIMATE_TO" ? "PROX" : "CO-LOC"} {n.link.confidence.toFixed(2)}
                  </Tag>
                </button>
              ))}
            </div>
          )}

          <div className="mer-sub">ANNOTATIONS</div>
```

Insert a new section between them:

```typescript
          <div className="mer-sub">LINKED OBJECTS ({detail.neighbors.length})</div>
          {detail.neighbors.length === 0 ? (
            <div className="mer-faint">No derived links.</div>
          ) : (
            <div className="mer-neighbors">
              {detail.neighbors.slice(0, 40).map((n) => (
                <button
                  key={n.object.id}
                  className="mer-neighbor"
                  onClick={() => onSelect(n.object.id)}
                  title={`basis: ${n.link.basis}`}
                >
                  <span className="mer-swatch" style={{ background: typeMap.get(n.object.type)?.color }} />
                  <span className="mer-neighbor-name">{n.object.name}</span>
                  <Tag minimal className="mer-mono mer-neighbor-kind">
                    {n.link.kind === "PROXIMATE_TO" ? "PROX" : "CO-LOC"} {n.link.confidence.toFixed(2)}
                  </Tag>
                </button>
              ))}
            </div>
          )}

          <div className="mer-sub">RELATED NEWS</div>
          {newsLoading ? (
            <div className="mer-faint">Loading...</div>
          ) : articles.length === 0 ? (
            <div className="mer-faint">No related news found.</div>
          ) : (
            <div className="mer-news-list">
              {articles.map((a) => (
                <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="mer-news-item">
                  <span className="mer-news-title">{a.title}</span>
                  <span className="mer-news-meta mer-mono">{a.source}</span>
                </a>
              ))}
            </div>
          )}

          <div className="mer-sub">ANNOTATIONS</div>
```

- [ ] **Step 2: Add the CSS**

In `web/src/styles.css`, find the `.mer-neighbors`/`.mer-neighbor` rules (search for `.mer-neighbor {` to locate the exact current block) and add a new block directly after them, following the same visual language:

```css
.mer-news-list { display: flex; flex-direction: column; gap: 4px; }
.mer-news-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border: 1px solid var(--mer-border);
  border-radius: 2px;
  color: var(--mer-text);
  text-decoration: none;
}
.mer-news-item:hover { background: rgba(255, 255, 255, 0.03); border-color: var(--mer-cyan-dim); }
.mer-news-title { font-size: 12px; line-height: 1.35; }
.mer-news-meta { font-size: 9px; color: var(--mer-text-dim); letter-spacing: 0.06em; text-transform: uppercase; }
```

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Verify live**

Start `npx wrangler dev` (remote mode). Open the app, click any real object on the map to open the Inspector, and run:

```js
document.querySelector('.mer-sub')?.parentElement && Array.from(document.querySelectorAll('.mer-sub')).map(el => el.textContent)
```

Expected: the array includes `"RELATED NEWS"` alongside the existing section headers. Then run:

```js
document.querySelectorAll('.mer-news-item').length
```

Expected: a number greater than or equal to 0 (0 is valid if that particular object genuinely has no related coverage; do not treat 0 as a failure on its own). Click a second, different object and confirm the section updates (re-run the same check, expect the returned count or article titles to differ, or to legitimately match if both objects happen to share the same country/domain/day cache bucket). Report the actual observed values for both objects.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Inspector.tsx web/src/styles.css
git commit -m "Add RELATED NEWS section to the Inspector"
```

---

## Plan self-review notes

- Spec coverage: query construction via admin0 + domain keyword + object name (Task 2), KV caching keyed by geo/domain/day not object id (Task 2, explicitly verified in Task 2 Step 5), quiet empty state matching the existing "No derived links" pattern (Task 4).
- The "skip DOC for GDELT-origin objects" rule from the original brief has no task here, correctly, since decision 1 (GDELT as overlay) means no object ever originates from GDELT in a way this Inspector flow would see.
- Type consistency: `NewsArticle` shape (`title`, `url`, `source`, `seendate`) is identical across `worker/index.ts`'s route response, `web/src/api.ts`'s type, and what `Inspector.tsx` destructures.
- The country-name table is scoped to verified production data (52 codes from a live D1 query on 2026-07-30) rather than an unverifiable hand-typed full ISO3 list, with an explicit, non-silent fallback (the geographic term simply drops out of the query) for anything not covered.
