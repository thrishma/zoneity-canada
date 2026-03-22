-- Zoneity Canada — seed Ontario municipalities (v2, 20 cities)
-- Run after migrate-v2.sql. Safe to re-run (ON CONFLICT DO UPDATE).

INSERT INTO municipalities (id, name, province, population, website, lat, lng, region) VALUES
  ('waterloo-on',      'Waterloo',        'ON', 121436,  'https://www.waterloo.ca',       43.4668, -80.5164, 'Waterloo Region'),
  ('kitchener-on',     'Kitchener',       'ON', 256885,  'https://www.kitchener.ca',      43.4516, -80.4925, 'Waterloo Region'),
  ('thunder-bay-on',   'Thunder Bay',     'ON', 110172,  'https://www.thunderbay.ca',     48.3809, -89.2477, 'Northwestern Ontario'),
  ('cambridge-on',     'Cambridge',       'ON', 145780,  'https://www.cambridge.ca',      43.3601, -80.3123, 'Waterloo Region'),
  ('guelph-on',        'Guelph',          'ON', 143740,  'https://guelph.ca',             43.5448, -80.2482, 'Wellington County'),
  ('hamilton-on',      'Hamilton',        'ON', 569353,  'https://www.hamilton.ca',       43.2557, -79.8711, 'Hamilton-Wentworth'),
  ('london-on',        'London',          'ON', 422324,  'https://www.london.ca',         42.9849, -81.2453, 'Southwestern Ontario'),
  ('windsor-on',       'Windsor',         'ON', 229660,  'https://www.citywindsor.ca',    42.3149, -83.0364, 'Southwestern Ontario'),
  ('ottawa-on',        'Ottawa',          'ON', 1017449, 'https://ottawa.ca',             45.4215, -75.6972, 'National Capital Region'),
  ('brampton-on',      'Brampton',        'ON', 656480,  'https://www.brampton.ca',       43.7315, -79.7624, 'Greater Toronto Area'),
  ('mississauga-on',   'Mississauga',     'ON', 721599,  'https://www.mississauga.ca',    43.5890, -79.6441, 'Greater Toronto Area'),
  ('markham-on',       'Markham',         'ON', 338503,  'https://www.markham.ca',        43.8561, -79.3370, 'Greater Toronto Area'),
  ('vaughan-on',       'Vaughan',         'ON', 344765,  'https://www.vaughan.ca',        43.8361, -79.4983, 'Greater Toronto Area'),
  ('barrie-on',        'Barrie',          'ON', 153356,  'https://www.barrie.ca',         44.3894, -79.6903, 'Simcoe County'),
  ('kingston-on',      'Kingston',        'ON', 136685,  'https://www.cityofkingston.ca', 44.2312, -76.4860, 'Eastern Ontario'),
  ('sudbury-on',       'Greater Sudbury', 'ON', 166004,  'https://www.greatersudbury.ca', 46.4917, -80.9930, 'Northern Ontario'),
  ('burlington-on',    'Burlington',      'ON', 186948,  'https://www.burlington.ca',     43.3255, -79.7990, 'Halton Region'),
  ('oshawa-on',        'Oshawa',          'ON', 166000,  'https://www.oshawa.ca',         43.8971, -78.8658, 'Durham Region'),
  ('richmond-hill-on', 'Richmond Hill',   'ON', 202022,  'https://www.richmondhill.ca',   43.8828, -79.4403, 'York Region'),
  ('oakville-on',      'Oakville',        'ON', 213759,  'https://www.oakville.ca',       43.4675, -79.6877, 'Halton Region')
ON CONFLICT (id) DO UPDATE SET
  name       = EXCLUDED.name,
  province   = EXCLUDED.province,
  population = EXCLUDED.population,
  website    = EXCLUDED.website,
  lat        = EXCLUDED.lat,
  lng        = EXCLUDED.lng,
  region     = EXCLUDED.region;
