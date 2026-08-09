# Roadmap batch: WHO feed, grounded summaries, live-updating mode

Status: approved, ready for implementation plans. Three independent sub-projects, each its own PR.

## Standing rules (all three)

Same as the earlier batch: commits as Nicolas Sanchez, zero AI attribution, no em-dashes anywhere, file a PR and do not merge or deploy without approval, verification means observed proof (live curl, real D1 rows, real DOM/console output) not source inspection.

## Context that changed since the README roadmap was written

- The account is now on the Workers Paid plan ($5/mo, already upgraded this week for D1 write headroom), so "live-updating mode... once sub-minute latency justifies leaving pure free-tier" is a smaller decision than the README implies: the account already left pure free-tier for an unrelated reason.
- GDELT (both GEO 2.0 and DOC 2.0) is unusable from this environment: GEO 2.0 is dead outright, DOC 2.0 is blocked for this IP with no clear resolution. Semantic correlation (`worker/semantic.ts`) stays as-is: the code works, it has nothing productive to correlate against without an overlapping-phrased feed, and nothing here fixes that. Not part of this batch.
- Energy: checked live (ODIN is US-county-only, GeoBlackout is crowdsourced not official, PowerOutage.us/com free tier is restricted to utilities/emergency-management accounts). No source meets the project's "official, public" bar. Stays deferred.
- WHO Disease Outbreak News DOES have a real structured API, contrary to the original spec's assumption: `https://www.who.int/api/news/diseaseoutbreaknews` (OData JSON, `$orderby=PublicationDate desc` confirmed working, real 2026 data, no key). This unblocks the health domain.

## Sub-project D: WHO Disease Outbreak News adapter

Fills the health domain. Follows the exact existing adapter pattern (`worker/adapters/*.ts`, e.g. `nifc.ts`, `gdacs.ts`), not a new architecture.

- Endpoint: `GET https://www.who.int/api/news/diseaseoutbreaknews?$top=50&$orderby=PublicationDate desc&$filter=PublicationDate ge {cutoff}`. Confirm the `$filter` date-range syntax against the live API in the first implementation step (OData filter syntax is fiddly; if it rejects the exact filter, sort-and-take-N without a date filter is an acceptable fallback, same spirit as this project's existing "verify then adapt" pattern).
- Fields: `Id` (dedup key, prefix `WHO-`), `PublicationDate` (event ts), `Title` (name), `Overview`/`Response` (props, HTML-stripped to plain text, capped length), `ItemDefaultUrl` (source_url, prefixed with `https://www.who.int`).
- No lat/lon or ISO3 in the payload. Country has to come from the `Title` text (WHO DON titles reliably name a country, e.g. "Avian influenza – situation in Egypt", "Ebola ... Democratic Republic of the Congo"). Match against a country-name-to-ISO3 table (build from the 52-entry ISO3-to-name table already written into `worker/index.ts` for the Inspector-news plan, inverted and extended as needed for names actually seen in a sample of live WHO titles) — substring match, first hit wins, no match leaves `admin0` null same as any other feed.
- Severity: no signal in the payload for it. Default to a flat baseline (severity 2, matching this project's existing convention for feeds with no native severity, e.g. how GDACS/CAP alerts without explicit magnitude default) rather than inventing a heuristic from unstructured text.
- Domain: `health`.
- Reliability weight: 0.92 (official WHO source, on par with the other UN/international-body sources already in `RELIABILITY`).
- Gating: not gated (WHO DON publishes a handful of items a week globally, nowhere near FIRMS/CAP volume; runs on the normal 15-min cron like NIFC/GDACS).
- SOURCES.md gets a new row.

## Sub-project E: Grounded event summaries (Workers AI)

Fills the "grounded event summaries" roadmap item. No external blocker; `AI` and `VEC` bindings already exist in `wrangler.jsonc`.

- New worker route `GET /api/summary?id=<object id>`. Looks up the object plus its existing Inspector-detail data (neighbors, entities — same shape `/api/object/:id` already assembles), builds a prompt from ONLY those structured fields, calls Workers AI (`@cf/meta/llama-3.1-8b-instruct`, already the common general-purpose instruct model on the platform), returns the generated text.
- Grounding discipline, the actual point of the feature: the prompt instructs the model to summarize the given facts in plain language and explicitly forbids adding any fact not present in the input (no invented casualty counts, no invented causes, no speculation). This is a prompt-engineering constraint, not a technical guarantee, so the UI must still show the object's real source/confidence alongside the summary, never in place of it, and the summary is visually marked as AI-generated commentary on the data, not as a new independent source.
- Caching: KV, keyed on object id, invalidated when the object's `last_seen`/`fetched_at` changes (so a re-ingested object regenerates its summary rather than serving stale text). TTL a few hours.
- UI: new "SUMMARY" section in `Inspector.tsx`, same visual language as the existing sections, loading/quiet-empty states matching the pattern already used for "No derived links."
- This sub-project's Inspector work and the never-shipped Inspector-news work touch the same file (`Inspector.tsx`) in a similar spot; sequence this after confirming Inspector-news is fully reverted/not half-applied in the working tree (it is not; that plan never got past its blocked Task 1, no Inspector.tsx changes exist).

## Sub-project F: Live-updating mode (WebSocket ticker)

Fills the "live-updating mode" roadmap item. Uses the WebSocket Hibernation API specifically so the account is not billed for idle connection duration, keeping this cheap even though the account is no longer pure free-tier.

- New Durable Object `LiveTicker` (`worker/live.ts`, exported from `worker/index.ts` alongside `AisCollector`), single global instance like AIS. Holds WebSocket connections from browser clients via `state.acceptWebSocket(ws)` (the hibernating form, not `ws.accept()`), so the DO can hibernate between broadcasts instead of staying billed as active.
- Cron ingest (`worker/ingest.ts`, end of `runIngest`), after computing which object ids are new this cycle, does a best-effort `env.LIVE.get(...).fetch(...)` push of the new ids to the DO, which relays them to every connected client. Best-effort: if the DO call fails, ingest must not fail (wrap in try/catch, same defensive posture as the rest of `runIngest`).
- Client: new hook opens a WebSocket to a `/api/live` upgrade route, listens for pushed id batches, and feeds them into the exact same `newIds` mechanism `useOntology`/`MapView` already use for the arrival-pulse animation. This does not replace the existing polling; polling stays as the backstop (matches this project's established "fail soft, never depend on one live channel" posture from the AIS/aircraft overlays), the WebSocket just makes pulses fire near-instantly instead of waiting for the next poll.
- No new UI. The existing pulse animation is the payoff; this sub-project only changes its latency.

## Sequencing

D (WHO adapter) first: mechanical, no design risk, immediately fills a real gap. E and F are independent of each other and of D; either order is fine.
