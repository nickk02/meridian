-- Stage A: domain as a first-class field, plus region columns for scoping.
-- Rerunnable (ADD COLUMN is idempotent only on a fresh table, so this migration
-- must run exactly once; the migrations tracker guarantees that). Never edit a
-- committed migration; add a new one.

ALTER TABLE objects ADD COLUMN domain TEXT NOT NULL DEFAULT 'other';
ALTER TABLE objects ADD COLUMN admin0 TEXT;  -- ISO 3166-1 alpha-3
ALTER TABLE objects ADD COLUMN admin1 TEXT;  -- state / province code

CREATE INDEX IF NOT EXISTS idx_objects_domain ON objects(domain);
CREATE INDEX IF NOT EXISTS idx_objects_admin0 ON objects(admin0);

-- Backfill the static infrastructure anchors.
UPDATE objects SET domain = 'maritime' WHERE type IN ('PORT', 'CHOKEPOINT');
UPDATE objects SET domain = 'aviation' WHERE type = 'AIRPORT';
