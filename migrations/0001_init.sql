-- Meridian ontology schema. Rerunnable: every object is created IF NOT EXISTS.
-- Never edit this file once committed; add a new migration instead.

CREATE TABLE IF NOT EXISTS object_types (
  id        TEXT PRIMARY KEY,
  label     TEXT NOT NULL,
  color     TEXT NOT NULL,
  geom_kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS objects (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL REFERENCES object_types(id),
  name       TEXT NOT NULL,
  lat        REAL NOT NULL,
  lon        REAL NOT NULL,
  severity   INTEGER DEFAULT 1,
  ts         INTEGER NOT NULL,
  source     TEXT,
  props      TEXT,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_objects_type ON objects(type);
CREATE INDEX IF NOT EXISTS idx_objects_ts ON objects(ts);

CREATE TABLE IF NOT EXISTS links (
  id         TEXT PRIMARY KEY,
  source_id  TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  target_id  TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  meta       TEXT,
  confidence REAL DEFAULT 1.0,
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id);

CREATE TABLE IF NOT EXISTS actions_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id TEXT NOT NULL,
  action    TEXT NOT NULL,
  actor     TEXT NOT NULL DEFAULT 'operator',
  payload   TEXT,
  ts        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_actions_object ON actions_log(object_id);

CREATE TABLE IF NOT EXISTS annotations (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id TEXT NOT NULL,
  text      TEXT NOT NULL,
  actor     TEXT NOT NULL DEFAULT 'operator',
  ts        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS state (
  object_id TEXT NOT NULL,
  key       TEXT NOT NULL,
  value     INTEGER NOT NULL,
  ts        INTEGER NOT NULL,
  PRIMARY KEY (object_id, key)
);
