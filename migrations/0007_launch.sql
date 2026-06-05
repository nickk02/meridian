-- Upcoming orbital launches (The Space Devs Launch Library). Rerunnable. Never
-- edit a committed migration; add a new one.

INSERT OR IGNORE INTO object_types (id, label, color, geom_kind) VALUES
  ('LAUNCH', 'Rocket Launch', '#c77dff', 'point');
