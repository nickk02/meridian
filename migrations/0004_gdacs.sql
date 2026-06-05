-- GDACS multi-hazard feed adds drought events. Rerunnable. Never edit a
-- committed migration; add a new one.

INSERT OR IGNORE INTO object_types (id, label, color, geom_kind) VALUES
  ('DROUGHT', 'Drought', '#caa46a', 'area');
