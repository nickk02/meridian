-- Stage G: cross-domain incidents. Events of DIFFERENT types that co-occur in
-- space and time AND share a plausible mechanism (co-causal whitelist). Stored
-- self-contained (members as JSON) since the set is rebuilt every correlate run
-- and read straight into the feed. Rerunnable.

CREATE TABLE IF NOT EXISTS cross_incidents (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  anchor_id    TEXT NOT NULL,
  centroid_lat REAL NOT NULL,
  centroid_lon REAL NOT NULL,
  t_start      INTEGER NOT NULL,
  t_end        INTEGER NOT NULL,
  member_count INTEGER NOT NULL,
  type_count   INTEGER NOT NULL,
  severity_max INTEGER NOT NULL,
  types        TEXT NOT NULL,   -- JSON array of distinct types
  domains      TEXT NOT NULL,   -- JSON array of distinct domains
  members      TEXT NOT NULL,   -- JSON array of {id,name,domain,type,severity,km,dtHr}
  created_ts   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cross_types ON cross_incidents(type_count, member_count);
