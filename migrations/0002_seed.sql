-- Seed the type registry and the static infrastructure anchors. Rerunnable via
-- INSERT OR IGNORE. Anchors are not ingested; they are fixtures that dynamic
-- events link to. Their timestamp is a fixed constant, they are not events.

INSERT OR IGNORE INTO object_types (id, label, color, geom_kind) VALUES
  ('AIRCRAFT',   'Aircraft',         '#4aa3ff', 'point'),
  ('VESSEL',     'Vessel',           '#2dd6e8', 'point'),
  ('SEISMIC',    'Seismic Event',    '#f2a93b', 'point'),
  ('WILDFIRE',   'Wildfire',         '#ff6b3d', 'area'),
  ('STORM',      'Storm',            '#9b8cff', 'area'),
  ('VOLCANO',    'Volcano',          '#ff4d4d', 'point'),
  ('ICE',        'Sea and Land Ice', '#8fd6ff', 'area'),
  ('FLOOD',      'Flood',            '#3d9bff', 'area'),
  ('NEWS_EVENT', 'News Event',       '#c0c7d0', 'point'),
  ('PORT',       'Port',             '#5bd6a0', 'point'),
  ('CHOKEPOINT', 'Maritime Chokepoint', '#e8d44d', 'point');

-- ts/first_seen/last_seen = 2025-01-01T00:00:00Z in epoch ms (anchors are static).
INSERT OR IGNORE INTO objects
  (id, type, name, lat, lon, severity, ts, source, props, first_seen, last_seen)
VALUES
  ('PORT-SHANGHAI',   'PORT', 'Port of Shanghai',           31.2304, 121.4737, 1, 1735689600000, 'anchors', '{"country":"CN"}', 1735689600000, 1735689600000),
  ('PORT-SINGAPORE',  'PORT', 'Port of Singapore',           1.2644, 103.8400, 1, 1735689600000, 'anchors', '{"country":"SG"}', 1735689600000, 1735689600000),
  ('PORT-ROTTERDAM',  'PORT', 'Port of Rotterdam',          51.9496,   4.1391, 1, 1735689600000, 'anchors', '{"country":"NL"}', 1735689600000, 1735689600000),
  ('PORT-LOSANGELES', 'PORT', 'Port of Los Angeles',        33.7405,-118.2723, 1, 1735689600000, 'anchors', '{"country":"US"}', 1735689600000, 1735689600000),
  ('PORT-HAMBURG',    'PORT', 'Port of Hamburg',            53.5405,   9.9846, 1, 1735689600000, 'anchors', '{"country":"DE"}', 1735689600000, 1735689600000),
  ('PORT-HONGKONG',   'PORT', 'Port of Hong Kong',          22.3027, 114.1772, 1, 1735689600000, 'anchors', '{"country":"HK"}', 1735689600000, 1735689600000),
  ('PORT-BUSAN',      'PORT', 'Port of Busan',              35.1028, 129.0403, 1, 1735689600000, 'anchors', '{"country":"KR"}', 1735689600000, 1735689600000),
  ('PORT-JEBELALI',   'PORT', 'Port of Jebel Ali',          25.0107,  55.0613, 1, 1735689600000, 'anchors', '{"country":"AE"}', 1735689600000, 1735689600000),
  ('PORT-NYNJ',       'PORT', 'Port of New York and New Jersey', 40.6677, -74.0430, 1, 1735689600000, 'anchors', '{"country":"US"}', 1735689600000, 1735689600000),
  ('PORT-ANTWERP',    'PORT', 'Port of Antwerp',            51.2603,   4.4000, 1, 1735689600000, 'anchors', '{"country":"BE"}', 1735689600000, 1735689600000),
  ('PORT-SANTOS',     'PORT', 'Port of Santos',            -23.9817, -46.2997, 1, 1735689600000, 'anchors', '{"country":"BR"}', 1735689600000, 1735689600000),
  ('PORT-DURBAN',     'PORT', 'Port of Durban',            -29.8714,  31.0258, 1, 1735689600000, 'anchors', '{"country":"ZA"}', 1735689600000, 1735689600000),

  ('CHOKEPOINT-HORMUZ',    'CHOKEPOINT', 'Strait of Hormuz',     26.5667,  56.2500, 2, 1735689600000, 'anchors', '{"connects":"Persian Gulf / Gulf of Oman"}', 1735689600000, 1735689600000),
  ('CHOKEPOINT-SUEZ',      'CHOKEPOINT', 'Suez Canal',           30.4250,  32.3500, 2, 1735689600000, 'anchors', '{"connects":"Mediterranean / Red Sea"}', 1735689600000, 1735689600000),
  ('CHOKEPOINT-PANAMA',    'CHOKEPOINT', 'Panama Canal',          9.0800, -79.6800, 2, 1735689600000, 'anchors', '{"connects":"Atlantic / Pacific"}', 1735689600000, 1735689600000),
  ('CHOKEPOINT-MALACCA',   'CHOKEPOINT', 'Strait of Malacca',     1.4300, 102.8900, 2, 1735689600000, 'anchors', '{"connects":"Andaman Sea / South China Sea"}', 1735689600000, 1735689600000),
  ('CHOKEPOINT-BABELMANDEB','CHOKEPOINT','Bab-el-Mandeb',        12.5833,  43.3333, 2, 1735689600000, 'anchors', '{"connects":"Red Sea / Gulf of Aden"}', 1735689600000, 1735689600000),
  ('CHOKEPOINT-BOSPHORUS', 'CHOKEPOINT', 'Bosphorus Strait',     41.1200,  29.0700, 2, 1735689600000, 'anchors', '{"connects":"Black Sea / Sea of Marmara"}', 1735689600000, 1735689600000),
  ('CHOKEPOINT-GIBRALTAR', 'CHOKEPOINT', 'Strait of Gibraltar',  35.9700,  -5.4900, 2, 1735689600000, 'anchors', '{"connects":"Atlantic / Mediterranean"}', 1735689600000, 1735689600000),
  ('CHOKEPOINT-DANISH',    'CHOKEPOINT', 'Danish Straits',       55.8700,  12.7000, 2, 1735689600000, 'anchors', '{"connects":"Baltic Sea / North Sea"}', 1735689600000, 1735689600000),
  ('CHOKEPOINT-GOODHOPE',  'CHOKEPOINT', 'Cape of Good Hope',   -34.3587,  18.4730, 2, 1735689600000, 'anchors', '{"connects":"Atlantic / Indian Ocean"}', 1735689600000, 1735689600000),
  ('CHOKEPOINT-TAIWAN',    'CHOKEPOINT', 'Taiwan Strait',        24.0000, 119.0000, 2, 1735689600000, 'anchors', '{"connects":"East China Sea / South China Sea"}', 1735689600000, 1735689600000);
