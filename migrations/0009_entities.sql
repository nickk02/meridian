-- Stage C: entity resolution. Entities are canonical real-world things; events
-- link to them so correlation across feeds means something. Rerunnable.

CREATE TABLE IF NOT EXISTS entities (
  id             TEXT PRIMARY KEY,
  type           TEXT NOT NULL,   -- country, place, vessel, aircraft, company, org, market, official
  canonical_name TEXT NOT NULL,
  wikidata_qid   TEXT,
  admin0         TEXT,
  geonames_id    INTEGER,
  lat            REAL,
  lon            REAL,
  first_seen     INTEGER NOT NULL,
  last_seen      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);

CREATE TABLE IF NOT EXISTS entity_links (
  id         TEXT PRIMARY KEY,    -- event_id|entity_id|role
  event_id   TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  role       TEXT NOT NULL,       -- is, located_in
  source     TEXT NOT NULL,       -- the resolution basis (deterministic:hex, feed:admin0, ...)
  confidence REAL NOT NULL,
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entity_links_event ON entity_links(event_id);
CREATE INDEX IF NOT EXISTS idx_entity_links_entity ON entity_links(entity_id);
