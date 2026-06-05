-- Stage D: provenance. Every object traces to a source URL, fetch time, and a
-- computed confidence; every link carries the basis that produced it.

ALTER TABLE objects ADD COLUMN source_url TEXT;
ALTER TABLE objects ADD COLUMN fetched_at INTEGER;
ALTER TABLE objects ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0;

-- A link with no basis is a bug; new links always set it explicitly in code.
ALTER TABLE links ADD COLUMN basis TEXT NOT NULL DEFAULT 'unspecified';
