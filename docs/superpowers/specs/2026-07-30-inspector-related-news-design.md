# Sub-project C: Inspector related news

Status: approved, ready for implementation plan. Depends on sub-project A's GDELT-calling plumbing (429 handling, KV caching pattern for a GDELT proxy route). Sequence after A.

## Standing rules

Same as sub-project A: commits as Nicolas Sanchez, zero AI attribution, no em-dashes anywhere, file a PR and do not merge or deploy without approval, verification means observed proof not source inspection, own PR, not combined with A or B.

## Scope

A new "RELATED NEWS" section inside the existing `Inspector.tsx`, populated when an object is selected. No new panel, no new interaction model: triggered by the existing object-selection flow, not by clicking empty map.

## What decision 1 (GDELT as overlay) changes here

The original brief carried a rule: "for any object that originated from GDELT itself, skip DOC entirely and reuse the article URLs GEO already returns." With GDELT rendered as a live overlay (sub-project A) rather than ontology objects, GDELT points are never Inspector-openable; they get their own map popup instead (see sub-project A). So this Inspector flow only ever sees genuine ontology objects (seismic, environmental, disaster, space, and future domains), and that bullet no longer applies. One less case to handle.

## Query construction, the hard part

Building the query from the object's name alone does not work: machine-generated names like "M 4.2 - 12km SE of <place>" match nothing useful, and GDELT DOC 2.0 has no lat/lon radius query, so geographic relevance has to arrive through place or country names.

Every ontology object already carries `admin0` (ISO3 country code), populated at ingest time via `worker/geo/reverse.ts`'s `countryAt()` (bundled Natural Earth admin-0 polygons, no per-request lookup needed). Query construction uses:

- The object's `admin0` resolved to a country name (a small static ISO3 to name lookup, not a new geocoding system).
- A domain-appropriate keyword set (e.g. seismic: "earthquake"; disaster: the object's own domain-mapped term).
- A time window bounded around the object's event timestamp (a few days either side, exact window decided during implementation against what DOC 2.0's date filtering actually accepts).

If `admin0` is null (an ocean event with no country match), fall back to a coarse lat/lon grid cell as the geographic anchor, the same rounding approach `firms.ts` already uses for grid dedup, rather than introducing a new geocoding dependency.

## Architecture

- New worker route `GET /api/news?id=<object id>`. Looks up the object, builds the query as above, proxies GDELT DOC 2.0 server-side. Same proxy pattern as `/api/tle`, and reuses the 429/`Retry-After` handling and non-200 surfacing established in sub-project A's `/api/gdelt` route rather than reimplementing it.
- New Inspector section rendered below "LINKED OBJECTS," showing title, source, and date for a handful of articles, each linking out.
- Empty result renders a quiet "No related news found," styled like the existing "No derived links" empty state in `Inspector.tsx`. Not an error banner.

## Caching

Keyed on `admin0 (or grid cell) + domain + time bucket`, not object id. Object-id keying means up to one distinct cache entry per object (roughly 1,700 today and growing), which risks the worker getting rate-limited by GDELT for what should be a handful of shared queries. Keying on country and domain means neighboring objects (e.g. two earthquakes in the same country the same week) share a cache entry. TTL around 1 hour, matching the existing TLE cache.

## Verification required before this is called done

- A live curl against the deployed `/api/news` route for a real object id, showing actual article results or a real "no results" response, not a source-code read.
- A screenshot or DOM read of the Inspector showing the RELATED NEWS section rendering for at least one real object.
- Confirmation that two objects sharing a country and domain within the same time bucket hit the same KV cache entry (observable via a cache-hit log or a KV read), demonstrating the keying actually works as designed, not just as written.
