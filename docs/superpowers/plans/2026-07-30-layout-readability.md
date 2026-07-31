# Layout readability implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four concrete readability problems in the live map UI: undersized text in the Layers panel, domain filter chips that give populated and empty domains identical visual weight, an easy-to-miss feed ticker on wide desktop, and sparse context at global zoom.

**Architecture:** Pure frontend changes in `web/src/`. No worker, no D1, no new dependencies. Each task is a self-contained CSS or component change, independently verifiable by DOM measurement.

**Tech Stack:** React 18, TypeScript, Blueprint.js (SegmentedControl, Tree), plain CSS in `web/src/styles.css`.

## Global Constraints

- Commits authored as Nicolas Sanchez. Zero AI attribution anywhere.
- No em-dashes anywhere: code, comments, commit messages, UI copy, docs.
- File a PR. Do not merge. Do not deploy (`wrangler deploy`) without explicit approval.
- "Verified" means observed proof: a real DOM computed-style measurement at a 1440x900 viewport, reported as an actual number. Not "looks better," not a green typecheck alone.
- Verify against `npx wrangler dev` (remote mode, default `wrangler.jsonc`, real D1 data, nothing published) not `npm run dev` (which forces `wrangler.local.jsonc` with placeholder/empty D1) and never against the production URL directly.
- Do not touch the mobile `@media (max-width: 820px)` path unless a task explicitly says to.
- This plan is its own PR. Do not combine with the GDELT overlay or Inspector news plans.

---

### Task 1: Bump Layers panel type scale from 10px to 13px

**Files:**
- Modify: `web/src/styles.css:94` (`.mer-layerctrl-head`)
- Modify: `web/src/styles.css:446` (`.mer-sev-seg .bp5-button`)

**Interfaces:** None. Pure CSS, no component changes.

- [ ] **Step 1: Change the Layers panel header font size**

In `web/src/styles.css`, find:

```css
.mer-layerctrl-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: var(--mer-mono);
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--mer-text);
}
```

Change `font-size: 10px;` to `font-size: 13px;`.

- [ ] **Step 2: Change the severity filter chip font size**

In the same file, find:

```css
.mer-sev-seg .bp5-button {
  background: transparent;
  box-shadow: none;
  border-radius: 0;
  color: var(--mer-text-dim);
  font-family: var(--mer-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
}
```

Change `font-size: 10px;` to `font-size: 13px;`.

Do not touch `.mer-view-btn` (`web/src/styles.css:132`), which is a different 10px rule for the MAP/GRAPH header toggle, out of scope for this task.

- [ ] **Step 3: Build and typecheck**

Run: `npm run typecheck`
Expected: no errors (CSS-only change, this is a sanity check that nothing else broke).

Run: `npm run build`
Expected: `vite build` succeeds, no warnings beyond the pre-existing chunk-size warning.

- [ ] **Step 4: Verify the actual rendered size**

Start `npx wrangler dev` (remote mode). Open the app in a browser tool at a 1440x900 viewport. Click the Layers button (top-left corner control) to open the panel. Run in the page console:

```js
JSON.stringify({
  header: getComputedStyle(document.querySelector('.mer-layerctrl-head')).fontSize,
  sevChip: getComputedStyle(document.querySelector('.mer-sev-seg .bp5-button')).fontSize,
})
```

Expected: `{"header":"13px","sevChip":"13px"}`. Report the actual returned string, not a paraphrase.

- [ ] **Step 5: Commit**

```bash
git add web/src/styles.css
git commit -m "Bump Layers panel text from 10px to 13px"
```

---

### Task 2: Sync ALL_DOMAINS with the real domain list and remove financial, cyber, sports

**Files:**
- Modify: `shared/types.ts:30-46` (the `Domain` type)
- Modify: `web/src/feed/domains.ts` (`ALL_DOMAINS`, `DOMAIN_COLOR`)

**Interfaces:**
- Produces: `Domain` (13 values instead of 16: removes `"financial"`, `"cyber"`, `"sports"`). `ALL_DOMAINS: Domain[]` now lists all 13 remaining domains, matching `Domain` exactly (currently it only lists 12 of the original 16 and is missing `transport`, `civic`, `political` entirely, and includes none of the three being removed, so after this task it must include the 4 previously-missing survivors: `transport`, `civic`, `political`, and drop nothing further).
- Consumes (later tasks): Task 3 reads `ALL_DOMAINS` and per-domain object counts to decide which chips to dim.

This is a breaking type change (`Domain` loses three members). Any code that references `"financial"`, `"cyber"`, or `"sports"` as a `Domain` literal will fail to typecheck; that failure is the intended signal for anything downstream that also needs updating.

- [ ] **Step 1: Remove the three domains from the shared type**

In `shared/types.ts`, find:

```typescript
export type Domain =
  | "environmental"
  | "financial"
  | "political"
  | "conflict"
  | "transport"
  | "maritime"
  | "aviation"
  | "seismic"
  | "space"
  | "health"
  | "energy"
  | "cyber"
  | "sports"
  | "civic"
  | "disaster"
  | "other";
```

Replace with:

```typescript
export type Domain =
  | "environmental"
  | "political"
  | "conflict"
  | "transport"
  | "maritime"
  | "aviation"
  | "seismic"
  | "space"
  | "health"
  | "energy"
  | "civic"
  | "disaster"
  | "other";
```

- [ ] **Step 2: Run typecheck to find every place that breaks**

Run: `npm run typecheck`
Expected: FAIL. Note every file and line reported. As of this plan being written, the only known reference to the removed literals is in `web/src/feed/domains.ts` (`DOMAIN_COLOR`), but trust the compiler output over this note; fix whatever it actually reports.

- [ ] **Step 3: Update ALL_DOMAINS and DOMAIN_COLOR**

In `web/src/feed/domains.ts`, find:

```typescript
export const DOMAIN_COLOR: Record<string, string> = {
  seismic: "#f2a93b",
  environmental: "#5bd6a0",
  disaster: "#ff5e5e",
  maritime: "#36d6e7",
  aviation: "#8fb6ff",
  space: "#c77dff",
  financial: "#f5b945",
  political: "#e0529c",
  conflict: "#ff4d4d",
  energy: "#ffd24a",
  cyber: "#36d6e7",
  health: "#7fd4ff",
  transport: "#9b8cff",
  sports: "#aeb8c6",
  civic: "#9aa6b8",
  other: "#8a93a3",
};

export const ALL_DOMAINS: Domain[] = [
  "seismic",
  "environmental",
  "disaster",
  "maritime",
  "aviation",
  "space",
  "financial",
  "conflict",
  "cyber",
  "energy",
  "health",
  "other",
];
```

Replace with:

```typescript
export const DOMAIN_COLOR: Record<string, string> = {
  seismic: "#f2a93b",
  environmental: "#5bd6a0",
  disaster: "#ff5e5e",
  maritime: "#36d6e7",
  aviation: "#8fb6ff",
  space: "#c77dff",
  political: "#e0529c",
  conflict: "#ff4d4d",
  energy: "#ffd24a",
  health: "#7fd4ff",
  transport: "#9b8cff",
  civic: "#9aa6b8",
  other: "#8a93a3",
};

export const ALL_DOMAINS: Domain[] = [
  "seismic",
  "environmental",
  "disaster",
  "maritime",
  "aviation",
  "space",
  "conflict",
  "political",
  "civic",
  "transport",
  "energy",
  "health",
  "other",
];
```

This adds `political`, `civic`, and `transport` to `ALL_DOMAINS` for the first time (they were already valid `Domain` values with `DOMAIN_COLOR` entries, just missing from the filter chip list, an existing inconsistency unrelated to this task's removals) and drops `financial`, `cyber`, `sports` from both.

- [ ] **Step 4: Run typecheck again**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 5: Run build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Verify the domain chip row live**

Start `npx wrangler dev` (remote mode). Open the app, expand the feed sheet (click the collapsed ticker), and run in the page console:

```js
Array.from(document.querySelectorAll('.mer-domain-toggle')).map(el => el.textContent.trim())
```

Expected: an array of exactly 13 domain names, containing `political`, `civic`, and `transport`, and containing none of `financial`, `cyber`, `sports`. Report the actual returned array.

- [ ] **Step 7: Commit**

```bash
git add shared/types.ts web/src/feed/domains.ts
git commit -m "Remove financial, cyber, sports domains and sync ALL_DOMAINS"
```

---

### Task 3: Dim domain chips with zero live objects

**Files:**
- Modify: `web/src/components/FeedView.tsx`
- Modify: `web/src/styles.css` (new rule near `.mer-domain-toggle`, `web/src/styles.css:1037-1052`)

**Interfaces:**
- Consumes: `ALL_DOMAINS: Domain[]` and `Domain` from `web/src/feed/domains.ts` and `shared/types.ts` (Task 2). `objects: OntologyObject[]` prop already received by `FeedView`, each with a `.domain: Domain` field.
- Produces: no new exports. `FeedView`'s domain toggle buttons gain a conditional `empty` class.

- [ ] **Step 1: Compute per-domain counts in FeedView**

In `web/src/components/FeedView.tsx`, the component currently starts:

```typescript
export function FeedView({ objects, incidents, crossIncidents, selectedId, onSelect }: Props) {
  const [mode, setMode] = useState<"all" | "cross">("all");
  const [domains, setDomains] = useState<Set<Domain>>(new Set(ALL_DOMAINS));
  const [region, setRegion] = useState("WORLD");
  const [expanded, setExpanded] = useState<string | null>(null);
```

Add a memoized count map right after the existing state declarations:

```typescript
export function FeedView({ objects, incidents, crossIncidents, selectedId, onSelect }: Props) {
  const [mode, setMode] = useState<"all" | "cross">("all");
  const [domains, setDomains] = useState<Set<Domain>>(new Set(ALL_DOMAINS));
  const [region, setRegion] = useState("WORLD");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Domains with zero live objects render dimmed, so the gap reads as
  // roadmap rather than breakage. Counted from the same objects the feed
  // already has, not a separate fetch.
  const domainCounts = useMemo(() => {
    const m = new Map<Domain, number>();
    for (const o of objects) m.set(o.domain, (m.get(o.domain) ?? 0) + 1);
    return m;
  }, [objects]);
```

- [ ] **Step 2: Apply the empty class to the chip row**

Find the domain toggle row:

```typescript
            <div className="mer-feed-domains">
              {ALL_DOMAINS.map((d) => (
                <button
                  key={d}
                  className={`mer-domain-toggle ${domains.has(d) ? "on" : ""}`}
                  style={{ borderColor: domains.has(d) ? DOMAIN_COLOR[d] : "transparent" }}
                  onClick={() => toggleDomain(d)}
                >
                  <span className="mer-domain-dot" style={{ background: DOMAIN_COLOR[d] }} />
                  {d}
                </button>
              ))}
            </div>
```

Replace with:

```typescript
            <div className="mer-feed-domains">
              {ALL_DOMAINS.map((d) => {
                const empty = (domainCounts.get(d) ?? 0) === 0;
                return (
                  <button
                    key={d}
                    className={`mer-domain-toggle ${domains.has(d) ? "on" : ""} ${empty ? "empty" : ""}`}
                    style={{ borderColor: domains.has(d) ? DOMAIN_COLOR[d] : "transparent" }}
                    onClick={() => toggleDomain(d)}
                    title={empty ? "No live objects in this domain yet" : undefined}
                  >
                    <span className="mer-domain-dot" style={{ background: DOMAIN_COLOR[d] }} />
                    {d}
                  </button>
                );
              })}
            </div>
```

- [ ] **Step 3: Add the empty-chip CSS rule**

In `web/src/styles.css`, find:

```css
.mer-domain-toggle.on { opacity: 1; color: #c6d0de; }
.mer-domain-dot { width: 7px; height: 7px; border-radius: 50%; }
```

Add a rule directly after `.mer-domain-toggle.on`, before `.mer-domain-dot`:

```css
.mer-domain-toggle.on { opacity: 1; color: #c6d0de; }
.mer-domain-toggle.empty.on { opacity: 0.35; }
.mer-domain-toggle.empty .mer-domain-dot { background: #3a424f !important; }
.mer-domain-dot { width: 7px; height: 7px; border-radius: 50%; }
```

`.empty.on` (two classes) has higher specificity than the single-class `.on` rule, so it wins regardless of source order. The `!important` on the dot color overrides the inline `style` attribute set in the JSX, which inline styles otherwise always win against; there is no other way to override an inline style from an external stylesheet.

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Verify against real data**

Start `npx wrangler dev` (remote mode, real D1 data). Open the app, expand the feed sheet, and run in the page console:

```js
JSON.stringify(
  Array.from(document.querySelectorAll('.mer-domain-toggle')).map(el => ({
    domain: el.textContent.trim(),
    empty: el.classList.contains('empty'),
    opacity: getComputedStyle(el).opacity,
  }))
)
```

Expected: domains known to have live D1 objects today (seismic, environmental, disaster, space) report `empty: false` and `opacity: "1"`; domains with none (conflict, civic, political, maritime, aviation, transport, energy, health, as of this plan) report `empty: true` and `opacity: "0.35"`. Report the actual returned array, since the exact populated set may have shifted by the time this runs.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/FeedView.tsx web/src/styles.css
git commit -m "Dim domain filter chips with zero live objects"
```

---

### Task 4: Give the feed ticker more presence on wide desktop

**Files:**
- Modify: `web/src/components/FeedSheet.tsx:18-20` (the height constants)
- Modify: `web/src/styles.css` (ticker row height, desktop-only)

**Interfaces:**
- Consumes: `window.innerWidth` (read directly, no new prop plumbing needed since `FeedSheet` already reads `window.innerHeight` for `DEFAULT_OPEN`).
- Produces: no new exports.

**Constraint:** must not change anything inside the existing `@media (max-width: 820px)` blocks in `web/src/styles.css`, and must not change `FeedSheet`'s behavior below 820px width. Verify this explicitly in Step 4.

- [ ] **Step 1: Raise the collapsed height on wide viewports**

In `web/src/components/FeedSheet.tsx`, find:

```typescript
const COLLAPSED = 46; // ticker-only height
const SNAP = COLLAPSED + 28; // below this we treat the sheet as collapsed
const DEFAULT_OPEN = () => Math.round(window.innerHeight * 0.6);
```

Replace with:

```typescript
const COLLAPSED_NARROW = 46; // ticker-only height, mobile and narrow desktop
const COLLAPSED_WIDE = 64; // taller ticker row above the desktop breakpoint
const WIDE_BREAKPOINT = 1200;
const collapsedHeight = () =>
  window.innerWidth >= WIDE_BREAKPOINT ? COLLAPSED_WIDE : COLLAPSED_NARROW;
const SNAP_MARGIN = 28;
const DEFAULT_OPEN = () => Math.round(window.innerHeight * 0.6);
```

- [ ] **Step 2: Use the dynamic collapsed height everywhere COLLAPSED was used**

Still in `web/src/components/FeedSheet.tsx`, find the remaining three uses of `COLLAPSED` and `SNAP`:

```typescript
export function FeedSheet(props: Props) {
  const { objects, newIds, onSelect } = props;
  const [height, setHeight] = useState(COLLAPSED);
  const [showHistory, setShowHistory] = useState(false);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const expanded = height > SNAP;
```

Replace with:

```typescript
export function FeedSheet(props: Props) {
  const { objects, newIds, onSelect } = props;
  const [height, setHeight] = useState(collapsedHeight);
  const [showHistory, setShowHistory] = useState(false);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const expanded = height > collapsedHeight() + SNAP_MARGIN;
```

Then find:

```typescript
  const clamp = (h: number) =>
    Math.min(window.innerHeight - 92, Math.max(COLLAPSED, h));
```

Replace with:

```typescript
  const clamp = (h: number) =>
    Math.min(window.innerHeight - 92, Math.max(collapsedHeight(), h));
```

Then find:

```typescript
  const toggle = () => setHeight((h) => (h > SNAP ? COLLAPSED : DEFAULT_OPEN()));
```

Replace with:

```typescript
  const toggle = () =>
    setHeight((h) => (h > collapsedHeight() + SNAP_MARGIN ? collapsedHeight() : DEFAULT_OPEN()));
```

Then find the two remaining literal `COLLAPSED` references, in the collapse button and the JSX height style:

```typescript
    <div className="mer-sheet" style={{ height }}>
```

This one does not need to change, `height` is already the state variable. Find:

```typescript
            <button className="mer-sheet-collapse" onClick={() => setHeight(COLLAPSED)} aria-label="Collapse">
```

Replace with:

```typescript
            <button className="mer-sheet-collapse" onClick={() => setHeight(collapsedHeight())} aria-label="Collapse">
```

- [ ] **Step 3: Give the wider ticker row more visual weight in CSS**

In `web/src/styles.css`, find the `.mer-ticker` rule (search for `mer-ticker {` to get the exact current block, since line numbers were not confirmed for this selector during planning; the block sets the collapsed ticker's layout). Add a new rule after it, scoped to the desktop breakpoint, that only affects sizing, not the DOM structure Task 4's mobile constraint cares about:

```css
@media (min-width: 1200px) {
  .mer-ticker-name { font-size: 13px; }
  .mer-ticker-time { font-size: 11px; }
}
```

Place this new block after the existing (non-mobile) ticker rules and before the `@media (max-width: 820px)` block, so it does not interfere with source-order-dependent mobile overrides (per the known CSS gotcha in this file: a later media query wins at equal specificity).

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Verify wide-desktop and mobile separately**

Start `npx wrangler dev` (remote mode). In a browser tool, resize to 1440x900 (wide desktop) and run:

```js
JSON.stringify({
  height: document.querySelector('.mer-sheet').getBoundingClientRect().height,
  nameFontSize: getComputedStyle(document.querySelector('.mer-ticker-name')).fontSize,
})
```

Expected: `height` is `64` (the new `COLLAPSED_WIDE`), `nameFontSize` is `"13px"`. Report the actual numbers.

Then resize to 390x844 (mobile) and run the same check:

```js
JSON.stringify({
  height: document.querySelector('.mer-sheet').getBoundingClientRect().height,
  nameFontSize: getComputedStyle(document.querySelector('.mer-ticker-name')).fontSize,
})
```

Expected: `height` is `46` (unchanged `COLLAPSED_NARROW`), `nameFontSize` is the original mobile value, not `13px`. Report the actual numbers. If mobile height or font size shifted from its pre-task value, this step fails and the change needs revisiting before commit, per the standing rule against touching the tuned mobile path.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/FeedSheet.tsx web/src/styles.css
git commit -m "Give the feed ticker more presence on wide desktop"
```

---

### Task 5: Small persistent context readout for global-zoom sparseness

**Files:**
- Modify: `web/src/App.tsx` (navbar object/link count tags, `web/src/App.tsx:217-223`)

**Interfaces:** None new. This reuses the existing `onto.objects.length` and `onto.links.length` values already computed in `App.tsx`.

This is deliberately the smallest item in this plan. The real fix for map sparseness is more live data (the GDELT overlay plan), not a visual trick here; this task adds one more piece of context without redesigning anything.

- [ ] **Step 1: Add a populated-domain count next to the existing tags**

In `web/src/App.tsx`, find:

```typescript
            {!isMobile && (
              <>
                <Tag minimal className="mer-mono" style={{ marginRight: 10 }}>
                  {onto.objects.length} OBJECTS
                </Tag>
                <Tag minimal className="mer-mono" style={{ marginRight: 10 }}>
                  {onto.links.length} LINKS
                </Tag>
              </>
            )}
```

Replace with:

```typescript
            {!isMobile && (
              <>
                <Tag minimal className="mer-mono" style={{ marginRight: 10 }}>
                  {onto.objects.length} OBJECTS
                </Tag>
                <Tag minimal className="mer-mono" style={{ marginRight: 10 }}>
                  {onto.links.length} LINKS
                </Tag>
                <Tag minimal className="mer-mono" style={{ marginRight: 10 }}>
                  {new Set(onto.objects.map((o) => o.domain)).size} DOMAINS
                </Tag>
              </>
            )}
```

This gives a persistent, honest readout of how many distinct domains actually have live data right now, alongside the object/link counts that already exist, without adding a new panel or touching the map rendering.

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Verify live**

Start `npx wrangler dev` (remote mode). Open the app at 1440x900 and run:

```js
document.querySelector('.bp5-navbar-group.bp5-align-right').textContent
```

Expected: the string includes a segment like `N DOMAINS` where N is a real small integer (matching however many distinct domains the current live data actually spans). Report the actual string.

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx
git commit -m "Add a live domain-count readout to the navbar"
```

---

## Plan self-review notes

- Spec coverage: all four `Sub-project B` items from the spec map to a task (Task 1: type scale, Task 3: empty-domain dimming, Task 4: ticker presence, Task 5: sparseness readout). Task 2 is a prerequisite the spec's decision 2 requires but did not itself assign a task number to; it is included here because Task 3 cannot compute correct domain counts against a stale `ALL_DOMAINS`.
- The mobile non-regression check is explicit in Task 4 Step 5 rather than assumed.
- No placeholders: every step shows the exact before/after code or the exact command and expected output.
