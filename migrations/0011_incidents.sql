-- Stage E part 1: spatiotemporal incidents from ST-DBSCAN. An incident is a
-- cluster of same-domain events close in both space and time (a quake swarm, a
-- wildfire complex, a storm seen by multiple feeds). Rerunnable.

ALTER TABLE objects ADD COLUMN incident_id TEXT;
CREATE INDEX IF NOT EXISTS idx_objects_incident ON objects(incident_id);

CREATE TABLE IF NOT EXISTS incidents (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  domain       TEXT NOT NULL,
  centroid_lat REAL NOT NULL,
  centroid_lon REAL NOT NULL,
  t_start      INTEGER NOT NULL,
  t_end        INTEGER NOT NULL,
  member_count INTEGER NOT NULL,
  severity_max INTEGER NOT NULL,
  created_ts   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incidents_members ON incidents(member_count);
