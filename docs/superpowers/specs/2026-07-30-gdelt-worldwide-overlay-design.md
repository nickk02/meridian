# Sub-project A: GDELT worldwide overlay

Status: approved, ready for implementation plan.

## Standing rules (apply to all three sub-projects in this batch)

- Commits authored as Nicolas Sanchez. Zero AI attribution anywhere: commits, PR bodies, code comments, docs.
- No em-dashes anywhere: code, comments, commit messages, UI copy, docs.
- File a PR. Do not merge. Do not deploy without explicit approval.
- "Verified" means observed proof: a live curl result against the deployed worker, a real row count from D1, a real screenshot or DOM measurement. Source inspection, a green typecheck, or a self-report of "should work" do not count.
- If a source or approach turns out not to work, stop and report blocked. Do not substitute something adjacent and call the task done.
- This is its own PR. Do not combine with sub-project B or C.

## Problem

Of the 16 domains the ontology declares, only 4 have live data (seismic, environmental-ish weather/wildfire, space, and static infrastructure anchors). Conflict, civic, and political read as permanently empty. GDELT is the best available worldwide, free, keyless source to fill them.

## What the original plan got wrong, and why it matters

GDELT GEO 2.0 (`api.gdeltproject.org/api/v2/geo/geo`) does not return discrete geocoded events. It returns aggregated location mentions with article counts, resolved at landmark, first-order-administrative-region, or country level. A query for `protest OR unrest OR conflict` returns points like "Sudan, 412 articles" plotted at the geographic centroid of Sudan.

If ingested as ontology objects this produces: country-centroid dots sitting in empty desert and open water that read as broken to anyone who knows the geography; no per-object event timestamp or severity to map onto existing ontology fields (article count is not severity); and an Inspector click that gives a place name and a number, a worse experience than the domains that already work.

## Decision (resolved 2026-07-30)

GDELT renders as a live overlay layer, the same class of thing as the existing AIS and aviation overlays: never written to D1, fetched by the client, rendered client-side. This sidesteps the D1 write-budget question entirely and matches what the data actually is (a live snapshot, not a stream of discrete events).

## Architecture

Same three-layer pattern as the AIS/TLE overlays already in the codebase:

1. **Worker proxy route** `GET /api/gdelt`. Proxies GDELT GEO 2.0 server-side (keeps the query string and any future key off the client, gives one place to add KV caching and rate-limit handling). Mirrors the existing `/api/tle` handler in `worker/index.ts`.
2. **Client fetch module** `web/src/map/gdelt.ts`. Same shape as `web/src/map/ais.ts`: fetch the proxy, turn the response into a GeoJSON `FeatureCollection`, fail soft to an empty collection on error.
3. **Render layer in `MapView.tsx`**. A deck.gl `ScatterplotLayer` (interleaved `MapboxOverlay`, same as satellites), not a MapLibre symbol/icon layer. Per `meridian-build-gotchas`, deck's `IconLayer` does not render in this codebase's interleaved setup (burned ~6 deploys establishing that); `ScatterplotLayer` and `PathLayer` are the proven-working deck primitives here. Radius and opacity scale with article count (`getRadius`, `getFillColor` alpha channel), giving the density-layer feel without a new rendering technology.
4. **Toggle chip** in `OverlayChips.tsx`, same pattern as Aircraft/Ships/Satellites (a fourth chip, e.g. "Unrest").

## Query construction

Start with a single query bucketed by domain intent (e.g. `protest OR unrest OR conflict OR clash`), timespan matched to the poll interval (see below), GeoJSON output. Exact CAMEO/keyword tuning happens during implementation against the live API; this is not a case where a wrong guess is expensive; it is one query string.

## Click behavior

GDELT points are an overlay, not ontology objects, so per the existing overlay convention (see `meridian-build-gotchas`, "Per-layer click events") they get a `maplibregl.Popup` on click, not the Inspector. The popup shows place name and article count, and optionally the first 2 to 3 article links GEO's own response already includes.

This resolves what would otherwise be an open question for sub-project C: "for any object that originated from GDELT itself, skip DOC entirely and reuse the article URLs GEO already returns." Since GDELT never becomes an Inspector-openable ontology object, sub-project C's related-news flow never sees a GDELT-origin object. That bullet is now moot, not because it was wrong, but because decision 1 removed the case it was guarding against.

## Client behavior and error handling

- GDELT throttles bursts hard and returns HTTP 429 with `Retry-After`. The worker proxy must space requests (respect a minimum poll interval server-side, similar to AIS's `MIN_RUN_GAP_MS`) and honor `Retry-After` rather than retrying into a 429 loop.
- Do not swallow non-200 responses or a 200-with-error-body. Apply the same fix already applied to `firms.ts`: a bad response throws (or is surfaced in a diagnostics field), not silently returned as empty. A silent empty overlay is indistinguishable from "no unrest anywhere today," which is never true.
- KV cache the proxy response briefly (a few minutes; GDELT's own data does not update faster than that) to protect both the free API and the 429 budget.

## Poll cadence

Client polls `/api/gdelt` on the same cadence as the other overlays (AIS/aircraft: 60s), but the worker-side KV cache means most of those polls are served from cache, not a fresh GDELT hit. Actual GDELT-hit cadence is a KV TTL decision made during implementation, informed by the 429 behavior observed against the live API.

## Verification required before this is called done

- A live `curl` against the deployed `/api/gdelt` route showing real GeoJSON output, not a source-code read.
- A screenshot or DOM check showing the overlay rendering points on the live map.
- Confirmation (via the same debug pattern as AIS's `?debug`) that a 429 is handled without a retry storm, either by triggering one deliberately or by demonstrating the `Retry-After` handling path exists and is exercised in a live request log.
- No D1 write-count check needed, since this never touches D1. If implementation drifts back toward ontology objects for any reason, stop and report blocked rather than proceeding without the dedupe key, per-cycle cap, and before/after write-delta report the original brief required for that path.

## Explicitly not in scope this round

WHO Disease Outbreak News (HTML only, no structured API) and ProMED (RSS with no geodata) both require free-text geocoding, which is its own project. Energy has no worldwide free real-time source identified yet. ReliefWeb is the strongest candidate for health and humanitarian coverage (structured JSON, worldwide, dedicated disasters endpoint) but is blocked on a pre-approved `appname`, required by the ReliefWeb API since 1 November 2025 and obtained only by Nick submitting a request form himself. ACLED is the authoritative conflict source rather than GDELT but requires registration and has redistribution restrictions in its license; its terms need reading before it is proposed again.

All four are tracked as research spikes, not implemented in this round.
