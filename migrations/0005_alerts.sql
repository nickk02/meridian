-- NWS / CAP weather and emergency alerts. Rerunnable. Never edit a committed
-- migration; add a new one.

INSERT OR IGNORE INTO object_types (id, label, color, geom_kind) VALUES
  ('ALERT', 'Weather Alert', '#ff5e5e', 'area');
