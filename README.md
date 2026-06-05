# Meridian

A live geospatial common operating picture with a persistent intelligence layer,
deployed edge-native on Cloudflare's free tier.

Meridian takes the live-feed map model (open infrastructure and environmental
feeds rendered on a world map) and adds what a transient-dot map lacks: a durable
ontology of typed objects, derived links between them, and audited operator
actions. Open feeds are ingested on a schedule, resolved into objects, linked by
proximity and co-location, and presented in a dark Palantir Blueprint operator
console with an inspector, an ego-graph view, and an append-only audit log.

## Architecture

A single Cloudflare Worker serves both the SPA and the API.

```
Browser (React + Blueprint + MapLibre)
        |
        v
Cloudflare Worker (Hono)
  /api/health        liveness
  /api/objects       read ontology from D1
  /api/links         read derived links from D1
  /api/object/:id    object detail + neighbors
  /api/action        write audited action + state
  /api/ingest/run    guarded manual ingest
  *                  SPA static assets (Vite build in ./dist)
        |
        +-- D1 (SQLite): the ontology and audit trail
        +-- KV: short-TTL feed cache
        |
Cron (*/15) -> ingest open feeds -> normalize -> upsert objects -> derive links
```

## Stack

- Cloudflare Workers with static assets (not Pages), Hono for the API.
- React 18 + TypeScript + Vite for the SPA.
- Palantir Blueprint for all UI chrome, applied dark globally.
- MapLibre GL JS for the map (no token).
- d3-force for the link-graph view.
- Cloudflare D1 for the ontology, KV for feed caching, Cron Triggers for ingest.
- zod for API payload validation.

Everything runs on Cloudflare's free tier. Nothing runs locally in production.

## Layout

```
meridian/
  worker/       Hono API, D1 access, feed adapters, ingestion cron handler
  web/          React + Blueprint + MapLibre SPA (builds to ./dist)
  shared/       types shared by Worker and SPA
  migrations/   D1 SQL migrations
  wrangler.jsonc, vite.config.ts, package.json
```

## Develop

```
npm install
npm run build      # vite build -> ./dist
npm run dev        # wrangler dev: serves the SPA and the API together
```

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`: `npm ci`, `npm run build`,
then `npx wrangler deploy`. The workflow needs two repository secrets,
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. D1 and KV are created once by
the operator and their IDs pasted into `wrangler.jsonc`.

## Scope

Open infrastructure and environmental feeds only: seismic, global events,
aviation, maritime, space weather, public infrastructure anchors. No targeting of
named private individuals. No scanner, and no scanning of anything the operator
does not own.
