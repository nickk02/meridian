# GDELT worldwide overlay implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render GDELT's worldwide conflict/civic/unrest location mentions as a live map overlay, the same class of thing as the existing AIS and aircraft overlays, filling three domains (conflict, civic, political) that currently have zero live data, without touching D1 or the write budget.

**Architecture:** Three layers, matching the existing AIS/TLE pattern exactly: a worker proxy route that fetches GDELT GEO 2.0 server-side (handles 429/Retry-After, caches in KV, surfaces real failures), a client fetch module that turns the response into GeoJSON, and a MapLibre circle layer plus a toggle chip that render and gate it. Nothing here is an ontology object; nothing here writes to D1.

**Tech Stack:** Hono (worker route), MapLibre GL JS (rendering, no deck.gl needed), plain `fetch` (client and worker).

## Global Constraints

- Commits authored as Nicolas Sanchez. Zero AI attribution anywhere.
- No em-dashes anywhere: code, comments, commit messages, UI copy, docs.
- File a PR. Do not merge. Do not deploy (`wrangler deploy`) without explicit approval.
- "Verified" means observed proof: a live curl result, a real DOM/console measurement. Not source inspection, not a green typecheck alone.
- If GDELT GEO 2.0 does not behave as this plan expects once actually queried (wrong field names, no usable count signal, a 429 that never clears), stop and report blocked. Do not substitute a different source and call the task done; that is a decision for Nick, not something to route around silently.
- GDELT points never become ontology objects. If any step in this plan is found to require touching the `objects` table or the `Domain` type, stop; that means the overlay decision needs revisiting, not a workaround.
- Verify against `npx wrangler dev` (remote mode, default `wrangler.jsonc`), not the production URL, since deploy requires separate approval.
- This plan is its own PR. Do not combine with the layout readability or Inspector news plans. The Inspector news plan (sequenced after this one) reuses this plan's 429/Retry-After handling pattern, so keep that logic in a form the next plan can read and copy, not buried inline.

---

### Task 1: Discover the real GDELT GEO 2.0 response shape

**Files:** None modified. This is a discovery step whose output (the actual field names) is required input to Task 2.

**Interfaces:** Produces: a confirmed response shape, recorded in this plan's own tracking (or the PR description) for Task 2 to build against.

- [ ] **Step 1: Query the live endpoint directly**

Run:

```bash
curl -s "https://api.gdeltproject.org/api/v2/geo/geo?query=protest%20OR%20unrest%20OR%20conflict&format=geojson&timespan=1d" | head -c 2000
```

Expected: a JSON `FeatureCollection`. Record the actual top-level shape and, for one representative feature, its `geometry` and `properties` keys exactly as returned. This plan's remaining tasks are written against the following best-current-knowledge hypothesis, which must be confirmed or corrected against this real output before writing Task 2's code: `type: "FeatureCollection"`, each feature has `geometry: {type: "Point", coordinates: [lon, lat]}` and `properties` including a location name field and a mention-count field (exact key names to be confirmed here, commonly `name` and `count` in GDELT's GEO API, but this has not been verified against a live response as of this plan being written).

- [ ] **Step 2: Confirm rate-limit behavior**

Run the same query 5 times in quick succession (a tight loop, no delay):

```bash
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{http_code} %{header_json}\n" "https://api.gdeltproject.org/api/v2/geo/geo?query=protest&format=geojson&timespan=1d"; done
```

Expected: either all 200s (GDELT tolerated the burst) or at least one 429. If a 429 appears, record whether a `Retry-After` header is present and its value. This confirms or corrects the spec's assumption that GDELT throttles bursts with `Retry-After`; Task 2's worker route is written to honor that header if present, and Task 1's findings determine whether that logic is actually exercised by a normal query pattern or is defensive-only.

- [ ] **Step 3: Record findings**

Write the confirmed shape and rate-limit behavior into the PR description for this sub-project before starting Task 2. If the response shape is fundamentally different from the hypothesis above (for example, no per-feature count signal at all), stop and report blocked rather than guessing at Task 2's parsing code.

---

### Task 2: Worker proxy route `/api/gdelt`

**Files:**
- Modify: `worker/index.ts` (new route, alongside the existing `/api/tle` and `/api/ais` routes)

**Interfaces:**
- Consumes: `c.env.CACHE` (existing `KVNamespace | undefined` binding, already in `Env`).
- Produces: `GET /api/gdelt` returning a GeoJSON `FeatureCollection` as JSON, `200` on success (including a valid empty `FeatureCollection` when GDELT itself returns zero features), non-200 with a JSON `{ error: string }` body when the upstream call fails or returns something unparseable. This is the endpoint `web/src/map/gdelt.ts` (Task 3) calls, and the endpoint the Inspector news plan's worker route reuses the rate-limit handling pattern from.

- [ ] **Step 1: Write the route**

In `worker/index.ts`, add after the existing `/api/tle` route (after line 104, before `app.get("/api/objects", ...)`):

```typescript
// Worldwide GDELT overlay: aggregated location mentions for conflict/civic/
// unrest keywords, rendered client-side as a live density layer. Never
// written to D1: GEO 2.0 returns place-level aggregates with article counts,
// not discrete timestamped events, so there is no ontology-object shape this
// fits (see docs/superpowers/specs/2026-07-30-gdelt-worldwide-overlay-design.md).
const GDELT_QUERY = "protest OR unrest OR conflict OR clash";
const GDELT_CACHE_KEY = "feed:gdelt";
const GDELT_CACHE_TTL_SECONDS = 300; // GDELT's own data does not update faster than this

app.get("/api/gdelt", async (c) => {
  const cache = c.env.CACHE;
  if (cache) {
    const hit = await cache.get(GDELT_CACHE_KEY);
    if (hit) return c.text(hit, 200, { "content-type": "application/json" });
  }
  const url = `https://api.gdeltproject.org/api/v2/geo/geo?query=${encodeURIComponent(GDELT_QUERY)}&format=geojson&timespan=1d`;
  let resp: Response;
  try {
    resp = await fetch(url, { headers: { "user-agent": "meridian-cop (github.com/nickk02/meridian)" } });
  } catch (e) {
    return c.json({ error: `GDELT fetch failed: ${String(e)}` }, 502);
  }
  if (resp.status === 429) {
    const retryAfter = resp.headers.get("retry-after");
    return c.json({ error: "GDELT rate limited", retryAfter: retryAfter ?? null }, 429);
  }
  if (!resp.ok) {
    return c.json({ error: `GDELT returned ${resp.status}: ${await resp.text()}` }, 502);
  }
  const text = await resp.text();
  // GDELT can return a 200 with a non-GeoJSON error body (established pattern
  // for this family of feeds; see the fix already applied to firms.ts). A
  // successful GeoJSON body always starts with the FeatureCollection type key.
  if (!text.trim().startsWith('{"type":"FeatureCollection"')) {
    return c.json({ error: `GDELT returned non-GeoJSON body: ${text.slice(0, 200)}` }, 502);
  }
  if (cache) await cache.put(GDELT_CACHE_KEY, text, { expirationTtl: GDELT_CACHE_TTL_SECONDS });
  return c.text(text, 200, { "content-type": "application/json" });
});
```

If Task 1 found the real response does not start with exactly `{"type":"FeatureCollection"` (for example, different key ordering), adjust the guard to match what was actually observed, not this guess.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Verify against the live GDELT API through the worker**

Start `npx wrangler dev` (remote mode). Run:

```bash
curl -s http://localhost:8787/api/gdelt | head -c 500
```

Expected: a real GeoJSON `FeatureCollection` (not a source-code read, an actual response body). Report the actual output.

- [ ] **Step 4: Verify the cache is actually used**

Run the same curl twice in a row, and check the worker dev console output between the two calls for evidence the second call served from KV rather than refetching GDELT (for example, no new outbound fetch logged, or add a temporary console log to the cache-hit branch and remove it before commit if that is the only way to observe it locally). Report what was actually observed.

- [ ] **Step 5: Commit**

```bash
git add worker/index.ts
git commit -m "Add GET /api/gdelt worker proxy for the worldwide overlay"
```

---

### Task 3: Client fetch module and MapLibre render layer

**Files:**
- Create: `web/src/map/gdelt.ts`
- Modify: `web/src/map/MapView.tsx`

**Interfaces:**
- Consumes: `GET /api/gdelt` (Task 2).
- Produces: `fetchGdelt(): Promise<FeatureCollection>` from `web/src/map/gdelt.ts`, following the exact shape of `fetchAis(): Promise<FeatureCollection>` in `web/src/map/ais.ts`. A new `gdeltOn: boolean` prop on `MapView`, following the exact pattern of `shipsOn`/`planesOn`/`satsOn`.

- [ ] **Step 1: Write the client fetch module**

Create `web/src/map/gdelt.ts`:

```typescript
// Live worldwide GDELT overlay: aggregated conflict/civic/unrest location
// mentions, fetched from the Worker proxy (never D1). Like AIS and aircraft,
// this is a live overlay, not ontology objects.
import type { FeatureCollection, Feature } from "geojson";

interface GdeltProperties {
  name?: string;
  count?: number;
}

export async function fetchGdelt(): Promise<FeatureCollection> {
  try {
    const r = await fetch("/api/gdelt");
    if (!r.ok) return { type: "FeatureCollection", features: [] };
    const fc = (await r.json()) as { features?: { geometry: { coordinates: [number, number] }; properties?: GdeltProperties }[] };
    const features: Feature[] = [];
    for (const f of fc.features ?? []) {
      const [lon, lat] = f.geometry.coordinates;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const count = typeof f.properties?.count === "number" ? f.properties.count : 1;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: { name: f.properties?.name ?? "Unknown location", count },
      });
    }
    return { type: "FeatureCollection", features };
  } catch {
    return { type: "FeatureCollection", features: [] };
  }
}
```

If Task 1 found different property key names than `name`/`count`, use the real ones here instead.

- [ ] **Step 2: Add the gdeltOn prop**

In `web/src/map/MapView.tsx`, find the `Props` interface:

```typescript
interface Props {
  objects: OntologyObject[];
  links: OntologyLink[];
  visibleTypes: Set<string>;
  severityMin: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  newIds: Set<string>;
  // Live-overlay visibility, owned by the on-map Layers control.
  satsOn: boolean;
  shipsOn: boolean;
  planesOn: boolean;
}
```

Add `gdeltOn: boolean;` after `planesOn: boolean;`.

Then find the import block at the top of the file:

```typescript
import { fetchAis } from "./ais";
import { fetchAircraft } from "./aircraft";
```

Add `import { fetchGdelt } from "./gdelt";` after the `fetchAircraft` import.

Then find, near the top of the `MapView` function body:

```typescript
  const satsOn = props.satsOn;
  const shipsOn = props.shipsOn;
  const planesOn = props.planesOn;
```

Add `const gdeltOn = props.gdeltOn;` after `planesOn`.

- [ ] **Step 3: Add the source and layer**

In the `map.on("load", ...)` handler, find the AIS source/layer block:

```typescript
      // Live global AIS vessels (overlay; refreshed by polling the collector DO).
```

Add a new source and layer directly before this AIS block:

```typescript
      // Live worldwide GDELT overlay (conflict/civic/unrest location mentions,
      // polled from the Worker proxy). Radius and opacity scale with mention
      // count via the same interpolate-expression pattern DOT_RADIUS already
      // uses for severity; this is a plain MapLibre circle layer, not deck.gl
      // (deck is reserved in this codebase for the satellite altitude case).
      map.addSource("gdelt", { type: "geojson", data: emptyFc() });
      map.addLayer({
        id: "gdelt",
        type: "circle",
        source: "gdelt",
        paint: {
          "circle-color": "#ff8a3d",
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["get", "count"],
            1, 3,
            50, 8,
            500, 18,
          ] as ExpressionSpecification,
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["get", "count"],
            1, 0.25,
            500, 0.7,
          ] as ExpressionSpecification,
          "circle-blur": 0.3,
        },
      });

```

- [ ] **Step 4: Poll the endpoint and toggle visibility**

Find the existing AIS poll effect:

```typescript
  // Poll the live AIS snapshot and toggle the vessel layer with shipsOn.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let alive = true;
    let id: number | undefined;
    const start = () => {
      if (!alive) return;
      const shipVis = shipsOn ? "visible" : "none";
      if (map.getLayer("ais")) map.setLayoutProperty("ais", "visibility", shipVis);
      if (map.getLayer("ais-symbols")) map.setLayoutProperty("ais-symbols", "visibility", shipVis);
      if (!shipsOn) return;
      const load = () =>
        fetchAis().then((fc) => {
          // The source exists once start() runs (after map load), so no ready
          // gate is needed here; that gate was dropping the first snapshot.
          if (alive) (map.getSource("ais") as GeoJSONSource | undefined)?.setData(fc);
        });
      load();
      id = window.setInterval(load, 60_000);
    };
    if (readyRef.current) start();
    else map.once("load", start);
    return () => {
      alive = false;
      if (id != null) window.clearInterval(id);
    };
  }, [shipsOn]);
```

Add a directly analogous effect after it, before the aircraft poll effect:

```typescript
  // Poll the live GDELT overlay and toggle visibility with gdeltOn. Polled
  // less often than AIS/aircraft since the worker-side KV cache (5 min TTL)
  // means faster client polling would not return fresher data anyway.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let alive = true;
    let id: number | undefined;
    const start = () => {
      if (!alive) return;
      if (map.getLayer("gdelt")) {
        map.setLayoutProperty("gdelt", "visibility", gdeltOn ? "visible" : "none");
      }
      if (!gdeltOn) return;
      const load = () =>
        fetchGdelt().then((fc) => {
          if (alive) (map.getSource("gdelt") as GeoJSONSource | undefined)?.setData(fc);
        });
      load();
      id = window.setInterval(load, 120_000);
    };
    if (readyRef.current) start();
    else map.once("load", start);
    return () => {
      alive = false;
      if (id != null) window.clearInterval(id);
    };
  }, [gdeltOn]);
```

- [ ] **Step 5: Wire the click popup**

Find the click handler's ship branch:

```typescript
        const ship = map.queryRenderedFeatures(box, { layers: ["ais"] })[0];
        if (ship) {
          showPopup(e.lngLat, "VESSEL", String(ship.properties?.["name"] ?? "unknown"));
          onSelectRef.current(null);
          return;
        }
```

Add a GDELT branch directly after it:

```typescript
        const unrest = map.queryRenderedFeatures(box, { layers: ["gdelt"] })[0];
        if (unrest) {
          const name = String(unrest.properties?.["name"] ?? "unknown");
          const count = unrest.properties?.["count"];
          showPopup(e.lngLat, "UNREST", `${name}${count != null ? ` · ${count} articles` : ""}`);
          onSelectRef.current(null);
          return;
        }
```

Also add `"gdelt"` to the hover cursor query so the pointer cursor shows over GDELT points. Find:

```typescript
        const over = map.queryRenderedFeatures(box, {
          layers: ["objects", "objects-symbols", "aircraft", "ais", "ais-symbols"],
        }).length > 0;
```

Replace with:

```typescript
        const over = map.queryRenderedFeatures(box, {
          layers: ["objects", "objects-symbols", "aircraft", "ais", "ais-symbols", "gdelt"],
        }).length > 0;
```

- [ ] **Step 6: Typecheck and build**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add web/src/map/gdelt.ts web/src/map/MapView.tsx
git commit -m "Render GDELT overlay as a count-scaled MapLibre circle layer"
```

---

### Task 4: Toggle chip

**Files:**
- Modify: `web/src/components/OverlayChips.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `gdeltOn` state lives in `App.tsx` (matching `satsOn`/`shipsOn`/`planesOn`), passed to both `OverlayChips` and `MapView`.

- [ ] **Step 1: Add the chip**

In `web/src/components/OverlayChips.tsx`, replace the whole file:

```typescript
// Small on-map chip row for the live overlays (aircraft, ships, satellites,
// worldwide unrest), pulled out of the Layers panel so they are always one
// click away.
interface Props {
  satsOn: boolean;
  shipsOn: boolean;
  planesOn: boolean;
  gdeltOn: boolean;
  onToggleSats: () => void;
  onToggleShips: () => void;
  onTogglePlanes: () => void;
  onToggleGdelt: () => void;
}

function Chip({ label, color, on, onClick }: { label: string; color: string; on: boolean; onClick: () => void }) {
  return (
    <button className={`mer-overlay-chip ${on ? "on" : ""}`} onClick={onClick} aria-pressed={on}>
      <span className="mer-overlay-dot" style={{ background: on ? color : "#3a424f" }} />
      {label}
    </button>
  );
}

export function OverlayChips(props: Props) {
  return (
    <div className="mer-overlay-chips">
      <Chip label="Aircraft" color="#8fb6ff" on={props.planesOn} onClick={props.onTogglePlanes} />
      <Chip label="Ships" color="#4ade80" on={props.shipsOn} onClick={props.onToggleShips} />
      <Chip label="Satellites" color="#eaf6ff" on={props.satsOn} onClick={props.onToggleSats} />
      <Chip label="Unrest" color="#ff8a3d" on={props.gdeltOn} onClick={props.onToggleGdelt} />
    </div>
  );
}
```

- [ ] **Step 2: Wire the state in App.tsx**

In `web/src/App.tsx`, find:

```typescript
  // Live-overlay visibility, owned here so the Layers control and the map share it.
  const [satsOn, setSatsOn] = useState(true);
  const [shipsOn, setShipsOn] = useState(true);
  const [planesOn, setPlanesOn] = useState(true);
```

Replace with:

```typescript
  // Live-overlay visibility, owned here so the Layers control and the map share it.
  const [satsOn, setSatsOn] = useState(true);
  const [shipsOn, setShipsOn] = useState(true);
  const [planesOn, setPlanesOn] = useState(true);
  const [gdeltOn, setGdeltOn] = useState(true);
```

Find the `overlayChips` definition:

```typescript
  const overlayChips = (
    <OverlayChips
      satsOn={satsOn}
      shipsOn={shipsOn}
      planesOn={planesOn}
      onToggleSats={() => setSatsOn((v) => !v)}
      onToggleShips={() => setShipsOn((v) => !v)}
      onTogglePlanes={() => setPlanesOn((v) => !v)}
    />
  );
```

Replace with:

```typescript
  const overlayChips = (
    <OverlayChips
      satsOn={satsOn}
      shipsOn={shipsOn}
      planesOn={planesOn}
      gdeltOn={gdeltOn}
      onToggleSats={() => setSatsOn((v) => !v)}
      onToggleShips={() => setShipsOn((v) => !v)}
      onTogglePlanes={() => setPlanesOn((v) => !v)}
      onToggleGdelt={() => setGdeltOn((v) => !v)}
    />
  );
```

Find the `<MapView ... />` usage:

```typescript
        <MapView
          objects={onto.objects}
          links={onto.links}
          visibleTypes={visible}
          severityMin={severityMin}
          selectedId={selectedId}
          onSelect={setSelectedId}
          newIds={onto.newIds}
          satsOn={satsOn}
          shipsOn={shipsOn}
          planesOn={planesOn}
        />
```

Replace with:

```typescript
        <MapView
          objects={onto.objects}
          links={onto.links}
          visibleTypes={visible}
          severityMin={severityMin}
          selectedId={selectedId}
          onSelect={setSelectedId}
          newIds={onto.newIds}
          satsOn={satsOn}
          shipsOn={shipsOn}
          planesOn={planesOn}
          gdeltOn={gdeltOn}
        />
```

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck`
Expected: PASS. This is where a missed prop or mismatched type shows up; do not skip this step even though it looks like a mechanical wiring change.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Verify live**

Start `npx wrangler dev` (remote mode). Open the app, confirm a fourth chip labeled "Unrest" appears in the overlay chip row, click it off and on, and confirm (via the console) the `gdelt` layer's visibility toggles:

```js
document.querySelector('[data-testid]');
```

Since there is no test-id convention in this codebase, instead verify through the map handle already exposed for this purpose:

```js
window.__merMap.getLayoutProperty('gdelt', 'visibility')
```

Expected: toggles between `"visible"` and `"none"` as the chip is clicked. Report the actual returned value at each state.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/OverlayChips.tsx web/src/App.tsx
git commit -m "Add Unrest overlay toggle chip for the GDELT layer"
```

---

## Plan self-review notes

- Spec coverage: worker proxy with 429/cache/failure-surfacing (Task 2), MapLibre circle rendering matching the corrected spec (Task 3), toggle chip (Task 4). The spec's "not in scope this round" items (WHO, ProMED, energy, ReliefWeb, ACLED) have no task here, correctly.
- Type consistency: `fetchGdelt(): Promise<FeatureCollection>` (Task 3) matches `fetchAis`'s signature exactly. `gdeltOn: boolean` prop name and wiring matches `shipsOn`/`planesOn`/`satsOn` exactly across `Props`, `App.tsx` state, and the `OverlayChips` props.
- Task 1 is unusual for this plan format (a discovery step producing no code) but necessary: writing Task 2 and 3's parsing code against unverified field names would violate the "no placeholders, no guessing" standard this plan otherwise holds itself to.
