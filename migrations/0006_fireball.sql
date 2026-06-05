-- NASA CNEOS atmospheric fireball/bolide events. Rerunnable. Never edit a
-- committed migration; add a new one.

INSERT OR IGNORE INTO object_types (id, label, color, geom_kind) VALUES
  ('FIREBALL', 'Fireball', '#ffd24a', 'point');
