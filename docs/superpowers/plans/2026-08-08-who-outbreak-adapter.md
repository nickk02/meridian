# WHO Disease Outbreak News adapter implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a WHO Disease Outbreak News feed adapter, filling the health domain, following the existing adapter pattern exactly.

**Architecture:** One new adapter file (`worker/adapters/who.ts`) matching the shape of `worker/adapters/nifc.ts`, registered in `worker/ingest.ts`'s `ADAPTERS`/`SOURCE_DOMAIN`/`RELIABILITY`/`SOURCE_URL` tables, plus a country-name-to-ISO3 extraction helper since the feed has no structured location field.

**Tech Stack:** Same as every other adapter: `cachedFetchJson` from `worker/cache.ts`, no new dependencies.

## Global Constraints

- Commits authored as Nicolas Sanchez. Zero AI attribution anywhere.
- No em-dashes anywhere: code, comments, commit messages, docs.
- File a PR. Do not merge. Do not deploy (`wrangler deploy`) without explicit approval.
- "Verified" means observed proof: a live curl against the deployed worker's `/api/ingest/run`, a real row count from D1. Not source inspection, not a green typecheck alone.
- Verify against `npx wrangler dev` (remote mode, default `wrangler.jsonc`) for typecheck/build sanity, but the real ingest verification needs the deployed worker (WHO's API, D1 writes) — coordinate with Nick before triggering a real `/api/ingest/run` against production, same as any other ingest-triggering change.
- This plan is its own PR.

---

### Task 1: Confirm the OData query shape and one real response

**Files:** None modified. Confirms the exact query this plan's code depends on.

- [ ] **Step 1: Confirm `$select`, `$filter`, `$orderby` all work together**

Run:

```bash
curl -s "https://www.who.int/api/news/diseaseoutbreaknews?%24top=5&%24orderby=PublicationDate%20desc&%24select=Id,PublicationDate,Title,ItemDefaultUrl,Overview" | head -c 2000
```

Expected: real JSON, `value` array of 5 items with exactly those 5 fields, newest `PublicationDate` first. Confirmed already this session; re-confirm live before building against it, since this plan assumes the exact field names `Id`, `PublicationDate`, `Title`, `ItemDefaultUrl`, `Overview`.

- [ ] **Step 2: Confirm a date-range `$filter` doesn't error**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://www.who.int/api/news/diseaseoutbreaknews?%24filter=PublicationDate%20ge%202026-07-01T00:00:00Z&%24top=5"
```

Expected: 200. If it's not 200, drop the `$filter` from Task 2's code and rely on `$orderby=PublicationDate desc&$top=N` plus this project's existing dedup-by-id upsert to stay correct without server-side date filtering.

---

### Task 2: Write the adapter

**Files:**
- Create: `worker/adapters/who.ts`
- Modify: `worker/ingest.ts` (register the adapter)

**Interfaces:**
- Produces: `whoAdapter: Adapter` (same shape as every other adapter in `worker/adapters/types.ts`), source string `"who"`, domain `"health"`.

- [ ] **Step 1: Write the country-name extraction helper and normalizer**

Create `worker/adapters/who.ts`:

```typescript
// WHO Disease Outbreak News. Official, keyless, OData JSON. No lat/lon or
// ISO3 in the payload; country comes from matching a known country name
// against the title text, which WHO DON titles reliably include (e.g.
// "Ebola disease caused by Bundibugyo virus - Democratic Republic of the
// Congo"). No match leaves admin0 null, same as any other feed.
import type { IngestObject } from "./types";
import type { Adapter } from "./types";

const WHO_BASE = "https://www.who.int/api/news/diseaseoutbreaknews";

// Name to ISO3, covering the countries that actually appear in WHO DON
// titles in practice. A country not in this table just yields a null
// admin0 rather than a wrong guess.
const COUNTRY_TO_ISO3: Record<string, string> = {
  "Democratic Republic of the Congo": "COD",
  "Uganda": "UGA",
  "India": "IND",
  "Egypt": "EGY",
  "Ethiopia": "ETH",
  "Nigeria": "NGA",
  "Kenya": "KEN",
  "South Sudan": "SSD",
  "Sudan": "SDN",
  "Yemen": "YEM",
  "Pakistan": "PAK",
  "Afghanistan": "AFG",
  "Indonesia": "IDN",
  "Philippines": "PHL",
  "Bangladesh": "BGD",
  "Madagascar": "MDG",
  "Zambia": "ZMB",
  "Zimbabwe": "ZWE",
  "Mozambique": "MOZ",
  "Tanzania": "TZA",
  "Cameroon": "CMR",
  "Chad": "TCD",
  "Niger": "NER",
  "Mali": "MLI",
  "Guinea": "GIN",
  "Liberia": "LBR",
  "Sierra Leone": "SLE",
  "Cote d'Ivoire": "CIV",
  "Somalia": "SOM",
  "Haiti": "HTI",
  "Brazil": "BRA",
  "Peru": "PER",
  "Colombia": "COL",
  "Mexico": "MEX",
  "China": "CHN",
  "Viet Nam": "VNM",
  "Thailand": "THA",
  "Saudi Arabia": "SAU",
  "United States of America": "USA",
  "United Kingdom": "GBR",
};

function findCountry(title: string): string | undefined {
  for (const [name, iso3] of Object.entries(COUNTRY_TO_ISO3)) {
    if (title.includes(name)) return iso3;
  }
  return undefined;
}

function stripHtml(html: string | undefined | null): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

interface WhoItem {
  Id: string;
  PublicationDate: string;
  Title: string;
  ItemDefaultUrl: string;
  Overview?: string | null;
}
interface WhoResponse {
  value: WhoItem[];
}

export function normalizeWho(feed: WhoResponse): IngestObject[] {
  const out: IngestObject[] = [];
  for (const item of feed.value ?? []) {
    const ts = Date.parse(item.PublicationDate);
    if (!Number.isFinite(ts)) continue;
    const admin0 = findCountry(item.Title);
    out.push({
      id: `WHO-${item.Id}`,
      type: "NEWS_EVENT",
      name: item.Title,
      lat: 0,
      lon: 0,
      severity: 2,
      ts,
      source: "who",
      admin0,
      props: {
        overview: stripHtml(item.Overview),
        url: `https://www.who.int${item.ItemDefaultUrl}`,
      },
    });
  }
  return out;
}

export const whoAdapter: Adapter = {
  source: "who",
  async fetchRaw(cache) {
    const url = `${WHO_BASE}?$top=50&$orderby=PublicationDate desc&$select=Id,PublicationDate,Title,ItemDefaultUrl,Overview`;
    return cachedFetchJson<WhoResponse>(cache, "feed:who", url, 21600);
  },
  normalize(raw) {
    return normalizeWho(raw as WhoResponse);
  },
};

import { cachedFetchJson } from "../cache";
```

Move the `import { cachedFetchJson } from "../cache";` line to the top of the file with the other imports (it is written last above only so the diff reads top-to-bottom with the logic before the wiring; actual file must have all imports at the top, matching every other file in this codebase).

Note: `lat: 0, lon: 0` with no `admin0` match will fail `isValidCoord` at ingest time (0,0 reads as invalid/null-island per `shared/coords.ts`) and the object gets dropped by the existing `droppedCoords` filter in `runIngest`, which is correct behavior for a WHO item naming no matchable country (better to drop it than plot it at Null Island). For a matched country, `lat`/`lon` need a real point, not 0,0: **this is a real gap in the draft above, fix it in this step, not left as a TODO** — use the country's bounding-box center from `worker/geo/countries.json` (already bundled, same file `worker/geo/reverse.ts` uses) as the anchor point when `admin0` is found, by reading that JSON's `bbox` for the matched ISO3 and averaging min/max lon/lat. If the ISO3 has no entry in `countries.json` (the bundled set covers 177 of ~195 countries), fall back to dropping the object rather than guessing coordinates.

- [ ] **Step 2: Register the adapter in ingest.ts**

In `worker/ingest.ts`, add the import alongside the other adapter imports:

```typescript
import { whoAdapter } from "./adapters/who";
```

Add `whoAdapter` to the `ADAPTERS` array.

Add to `SOURCE_DOMAIN`: `who: "health",`

Add to `RELIABILITY`: `who: 0.92,`

Add to `SOURCE_URL`: `who: "https://www.who.int/emergencies/disease-outbreak-news",` (fallback only; most items will have their own `props.url` via `sourceUrlFor`'s existing `p["url"]` check, confirm `who.ts`'s `props.url` key matches what `sourceUrlFor` in `ingest.ts` already reads).

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add worker/adapters/who.ts worker/ingest.ts
git commit -m "Add WHO Disease Outbreak News adapter for the health domain"
```

---

### Task 3: Add to SOURCES.md and verify live ingest

**Files:**
- Modify: `SOURCES.md`

- [ ] **Step 1: Add the WHO row**

In `SOURCES.md`'s feed table, add: `| WHO Disease Outbreak News | health | World Health Organization | 0.92 | who.int/api/news | Official, public |`

- [ ] **Step 2: Commit**

```bash
git add SOURCES.md
git commit -m "Document the WHO feed in SOURCES.md"
```

- [ ] **Step 3: Verify against the deployed worker**

This step needs the real deployed worker (WHO's API and D1 are both external to local dev). Coordinate before running: this triggers a real `/api/ingest/run` against production D1, same caution as any other ingest-triggering change this session.

```bash
curl -s -X POST -H "Authorization: Bearer <INGEST_TOKEN>" "https://meridian.calm-butterfly-4753.workers.dev/api/ingest/run"
```

Expected: the JSON result's `sources` array includes `{"source":"who","count":N}` with N > 0. Report the actual count.

Then:

```sql
SELECT admin0, COUNT(*) FROM objects WHERE source = 'who' GROUP BY admin0
```

(via the D1 MCP query tool against database id `9fbd9bd2-6d0e-4fb7-b9be-272f4bc0d6e5`) to confirm real rows landed with plausible country codes, not all-null.
