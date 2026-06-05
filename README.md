# Meridian

Connecting the world's events in real time.

Meridian is an open-source global event-intelligence dashboard. It ingests live, official, public data feeds from around the world, resolves them into a durable ontology of typed objects, links those objects by what they share in space, time, and identity, and presents the result as a live map, a scoped event feed, and a link graph. Every object traces to its source with a timestamp and an honest confidence score. Correlations show the basis for the link and never assert causation.

It runs entirely on Cloudflare's free tier.

<!-- ![Meridian](docs/screenshot.png) screenshot/GIF of the globe + feed, to be added once the cartography polish lands -->

Live instance: https://meridian.calm-butterfly-4753.workers.dev

## What makes Meridian different

Most "intelligence dashboards" are a map with dots. The dots appear, the dots disappear, and nothing connects them. Meridian's premise is the opposite: the value is not the dots, it is the connections between them, surfaced honestly.

* Grounded, not fabricated. Every event carries its source, fetch time, and a confidence score that decays with age. A 37-day-old event reads as low-confidence because it is. Nothing is invented to look authoritative.
* Correlation, never fake causation. When events are linked, the link records its basis (spatio-temporal proximity today; shared entity and semantic similarity on the roadmap) and a confidence. Meridian shows that events co-occurred and why they may be related. It never claims one caused another. That judgment is left to the analyst.
* Real entity resolution. Aircraft resolve by ICAO hex, vessels by MMSI, places by country and gazetteer. The same real-world thing seen through different feeds becomes one entity, so the links between events actually mean something.
* Official and public sources only. No surveillance of named private individuals. No network scanning. No scanner audio. No facial recognition. No license-plate data. Meridian is a tool for understanding the world from public, official, aggregate information, not for watching people or probing infrastructure.
* Edge-native and free. The whole system runs on Cloudflare Workers, D1, KV, R2, and Cron, within the free tier. Vectorize and Workers AI are provisioned for the semantic-correlation and grounded-summary work on the roadmap.

## How it works

```
Live public feeds  ->  Cron ingest  ->  raw archive (R2)
                                            |
                                            v
                                     normalize to typed events
                                            |
                                            v
                          D1 ontology  <->  entity resolution (hex / MMSI / ISO3 / gazetteer)
                                            |
                                            v
                          correlation engine (spatio-temporal proximity)
                                            |
                                            v
            Map (MapLibre, flat + globe)  +  scoped event feed  +  link graph  +  inspector
```

Feeds are pulled on a schedule and archived as raw JSON in R2, then normalized into typed objects in D1. Because the raw tier is preserved, an upstream outage re-normalizes from the last archived blob instead of dropping the layer, and the archive doubles as replay history. Objects are resolved into entities, linked by the correlation engine, and read by the front end. Reads never hit the live sources.

## The object model

Every event normalizes to a typed object: `{ id, domain, lat, lon, timestamp, severity, source, source_url, fetched_at, confidence, properties }`, tagged with one of 16 domains (seismic, environmental, disaster, maritime, aviation, space, financial, conflict, cyber, energy, health, transport, sports, civic, political, other) plus country and admin-1 region. Domains and regions are first-class, so "scopes" (for example, Europe today, or global maritime and energy) are simply saved filters over the same data.

Spatio-temporally clustered events are folded into incidents: one anchor event plus the events that occur within a tight distance and time window of it, each member linked to the anchor with a stated basis. The cluster is anchor-radial by design, so an incident cannot sprawl across unrelated regions.

## Provenance and confidence

Every object stores where it came from, when it was fetched, and a confidence score derived from source reliability and recency. Every link stores its basis and confidence. A link without a basis cannot be created. This is enforced in code, not by convention.

## Architecture

A single Cloudflare Worker serves both the SPA and the API.

```
Browser (React + TypeScript + MapLibre GL)
        |
        v
Cloudflare Worker (Hono)
  /api/health         liveness
  /api/objects        read ontology from D1
  /api/links          read derived links from D1
  /api/object/:id     object detail + neighbors + provenance + entities
  /api/incidents      correlated incident clusters
  /api/incident/:id   incident detail + members
  /api/entity/:id     resolved entity + its events
  /api/action         write audited action + state
  /api/ingest/run     guarded manual ingest (token-protected)
  *                   SPA static assets (Vite build in ./dist)
        |
        +-- D1 (SQLite): ontology, entities, links, incidents, audit trail
        +-- KV: short-TTL feed cache + write budgets
        +-- R2: raw feed archive (replay + resilience)
        +-- Vectorize: semantic-correlation index (provisioned; roadmap)
        +-- Workers AI: grounded summaries (provisioned; roadmap)
        |
Cron -> ingest feeds -> archive raw (R2) -> normalize -> resolve entities -> derive links -> correlate
```

## Stack

* Cloudflare Workers with static assets (not Pages), Hono for the API.
* React 18 + TypeScript + Vite for the SPA.
* MapLibre GL JS for the map, flat and globe projection, no token required.
* d3-force for the link-graph view.
* Cloudflare D1 (ontology + audit), KV (cache), R2 (raw archive), Cron (ingest). Vectorize and Workers AI are bound and provisioned for roadmap work (semantic correlation, grounded summaries).
* zod for API payload validation.

Everything runs on Cloudflare's free tier. Nothing runs locally in production.

## Layout

```
meridian/
  worker/       Hono API, D1 access, feed adapters, ingestion + correlation
  web/          React + MapLibre SPA (builds to ./dist)
  shared/       types shared by Worker and SPA
  migrations/   D1 SQL migrations
  wrangler.jsonc, vite.config.ts, package.json
```

## Develop

```
npm install
npm run build      # vite build -> ./dist
npm run dev        # wrangler dev (local config): serves the SPA and the API together
```

## Deploy

Pushing to `main` triggers Cloudflare Workers Builds: `npm ci && npm run build`, then deploy, with D1 migrations applied automatically. D1, KV, R2, and the Vectorize index are created once by the operator; their bindings live in `wrangler.jsonc`. Secrets (`INGEST_TOKEN`, feed API keys) are set as Worker secrets, never committed.

## Data sources

Meridian draws only on official, public, free, and legal feeds. Live layers today include seismic (USGS), aviation (ADS-B via airplanes.live), maritime AIS (Digitraffic), wildfire (NIFC), weather alerts (NWS), tropical cyclones (NHC), environmental events (NASA EONET), disasters (GDACS), and space (CNEOS fireballs, Launch Library), with more official sources being added in waves. See [SOURCES.md](SOURCES.md) for the full feed list and the provenance of each.

## Roadmap

Not yet live, in build order:

* Shared-entity and semantic correlation (Vectorize embeddings + Workers AI), beyond the spatio-temporal links shipping today.
* Grounded event summaries via Workers AI, cited to sources, never invented.
* Live-updating mode: new events animate onto the map as they arrive (a Durable Object WebSocket ticker, once sub-minute latency justifies leaving pure free-tier).
* Additional official feeds across the financial, energy, health, and civic domains.

## Scope and ethics

Meridian uses official, public, aggregate sources only. It does not track named private individuals, scan or probe infrastructure it does not own, ingest scanner audio, perform facial recognition, or collect license-plate or personal-social-media data. Several free feeds are licensed for non-commercial use; Meridian honors each source's license and records it per source. Correlations are labeled as correlations, never as proven cause.

## Security

Security findings are taken seriously and fixed before new features ship. See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Contributing

Contributions are welcome. Because Meridian is offered under a dual license (see below), external contributions require a Contributor License Agreement before they can be merged, so the project retains the right to offer commercial licenses. See [CONTRIBUTING.md](CONTRIBUTING.md) for the process and [CLA.md](CLA.md) for the agreement.

## License

Meridian is AGPL-3.0 for open-source use. Meridian is original work, not a fork. Running a modified version as a network service requires offering its source under the same license. See [LICENSE](LICENSE).

For a commercial license without AGPL obligations, contact the maintainer (Nick Sanchez, github.com/nickk02).
