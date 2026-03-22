-- Zoneity Canada — schema migration v2
-- Run after setup-db.sql.
-- Adds: lat/lng, region, confidence scores, data quality flags,
--       bylaw amendments, province config (scalability).

-- ── municipalities: add geospatial and region columns ─────────────────────────

ALTER TABLE municipalities
  ADD COLUMN IF NOT EXISTS lat       NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS lng       NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS region    TEXT,           -- e.g. "Greater Toronto Area"
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Seed coordinates for known Ontario municipalities
UPDATE municipalities SET lat = 43.4668, lng = -80.5164, region = 'Waterloo Region'
  WHERE id = 'waterloo-on';
UPDATE municipalities SET lat = 43.4516, lng = -80.4925, region = 'Waterloo Region'
  WHERE id = 'kitchener-on';
UPDATE municipalities SET lat = 48.3809, lng = -89.2477, region = 'Northwestern Ontario'
  WHERE id = 'thunder-bay-on';
UPDATE municipalities SET lat = 43.3601, lng = -80.3123, region = 'Waterloo Region'
  WHERE id = 'cambridge-on';
UPDATE municipalities SET lat = 43.5448, lng = -80.2482, region = 'Wellington County'
  WHERE id = 'guelph-on';
UPDATE municipalities SET lat = 43.2557, lng = -79.8711, region = 'Hamilton-Wentworth'
  WHERE id = 'hamilton-on';
UPDATE municipalities SET lat = 42.9849, lng = -81.2453, region = 'Southwestern Ontario'
  WHERE id = 'london-on';
UPDATE municipalities SET lat = 42.3149, lng = -83.0364, region = 'Southwestern Ontario'
  WHERE id = 'windsor-on';
UPDATE municipalities SET lat = 45.4215, lng = -75.6972, region = 'National Capital Region'
  WHERE id = 'ottawa-on';
UPDATE municipalities SET lat = 43.7315, lng = -79.7624, region = 'Greater Toronto Area'
  WHERE id = 'brampton-on';
UPDATE municipalities SET lat = 43.5890, lng = -79.6441, region = 'Greater Toronto Area'
  WHERE id = 'mississauga-on';
UPDATE municipalities SET lat = 43.8561, lng = -79.3370, region = 'Greater Toronto Area'
  WHERE id = 'markham-on';
UPDATE municipalities SET lat = 43.8361, lng = -79.4983, region = 'Greater Toronto Area'
  WHERE id = 'vaughan-on';
UPDATE municipalities SET lat = 44.3894, lng = -79.6903, region = 'Simcoe County'
  WHERE id = 'barrie-on';
UPDATE municipalities SET lat = 44.2312, lng = -76.4860, region = 'Eastern Ontario'
  WHERE id = 'kingston-on';
UPDATE municipalities SET lat = 46.4917, lng = -80.9930, region = 'Northern Ontario'
  WHERE id = 'sudbury-on';
UPDATE municipalities SET lat = 43.3255, lng = -79.7990, region = 'Halton Region'
  WHERE id = 'burlington-on';
UPDATE municipalities SET lat = 43.8971, lng = -78.8658, region = 'Durham Region'
  WHERE id = 'oshawa-on';
UPDATE municipalities SET lat = 43.8828, lng = -79.4403, region = 'York Region'
  WHERE id = 'richmond-hill-on';
UPDATE municipalities SET lat = 43.4675, lng = -79.6877, region = 'Halton Region'
  WHERE id = 'oakville-on';

-- ── bylaw_metrics: add confidence score and extraction method ─────────────────

ALTER TABLE bylaw_metrics
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(3,2),   -- 0.00–1.00
  ADD COLUMN IF NOT EXISTS extraction_method TEXT            -- 'regex' | 'llm' | 'manual'
    CHECK (extraction_method IN ('regex', 'llm', 'manual'));

-- ── data_quality_flags: anomaly and review tracking ───────────────────────────

CREATE TABLE IF NOT EXISTS data_quality_flags (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id  TEXT NOT NULL REFERENCES municipalities(id),
  metric_key       TEXT,
  flag_type        TEXT NOT NULL CHECK (flag_type IN (
                     'anomaly',       -- value outside expected range
                     'missing',       -- expected metric not found
                     'stale',         -- bylaw document older than threshold
                     'conflict',      -- two sources disagree
                     'needs_review'   -- manual QA needed
                   )),
  severity         TEXT NOT NULL DEFAULT 'medium'
                     CHECK (severity IN ('low', 'medium', 'high')),
  description      TEXT NOT NULL,
  resolved         BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flags_municipality ON data_quality_flags(municipality_id);
CREATE INDEX IF NOT EXISTS idx_flags_resolved     ON data_quality_flags(resolved);
CREATE INDEX IF NOT EXISTS idx_flags_severity     ON data_quality_flags(severity);

-- ── bylaw_amendments: track bylaw changes and amendments ─────────────────────

CREATE TABLE IF NOT EXISTS bylaw_amendments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      UUID NOT NULL REFERENCES bylaw_documents(id),
  municipality_id  TEXT NOT NULL REFERENCES municipalities(id),
  amendment_number TEXT,                  -- e.g. "ZBA-2024-12"
  effective_date   DATE,
  description      TEXT,
  source_url       TEXT,
  ingested_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_amendments_document     ON bylaw_amendments(document_id);
CREATE INDEX IF NOT EXISTS idx_amendments_municipality ON bylaw_amendments(municipality_id);
CREATE INDEX IF NOT EXISTS idx_amendments_date         ON bylaw_amendments(effective_date);

-- ── province_config: scraper configuration per province ───────────────────────
-- Supports national expansion: each province can have different scrape strategies,
-- rate limits, and parser modules.

CREATE TABLE IF NOT EXISTS province_config (
  province_code    TEXT PRIMARY KEY,    -- 'ON', 'BC', 'AB', 'QC', etc.
  province_name    TEXT NOT NULL,
  parser_module    TEXT NOT NULL DEFAULT 'ontario_parser',
  rate_limit_rps   NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  notes            TEXT,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO province_config (province_code, province_name, parser_module, notes) VALUES
  ('ON', 'Ontario', 'ontario_parser', 'Primary province — fully operational'),
  ('BC', 'British Columbia', 'generic_parser', 'Planned Q2 2026 — zoning reform underway'),
  ('AB', 'Alberta', 'generic_parser', 'Planned Q3 2026'),
  ('QC', 'Quebec', 'quebec_parser', 'Planned — French bylaw documents require separate parser'),
  ('MB', 'Manitoba', 'generic_parser', 'Planned'),
  ('SK', 'Saskatchewan', 'generic_parser', 'Planned'),
  ('NS', 'Nova Scotia', 'generic_parser', 'Planned'),
  ('NB', 'New Brunswick', 'generic_parser', 'Planned — bilingual documents'),
  ('NL', 'Newfoundland and Labrador', 'generic_parser', 'Planned'),
  ('PE', 'Prince Edward Island', 'generic_parser', 'Planned')
ON CONFLICT (province_code) DO NOTHING;

-- Only ON is active initially
UPDATE province_config SET active = FALSE WHERE province_code != 'ON';

-- ── Seed initial quality flags for known data gaps ────────────────────────────

INSERT INTO data_quality_flags (municipality_id, metric_key, flag_type, severity, description) VALUES
  ('kitchener-on', 'min_lot_size_sqm', 'missing', 'high',
   'Kitchener zoning bylaw is primarily schedule maps (496 pages); text extraction yielded 0 sections. Needs manual review or alternate source URL.'),
  ('kitchener-on', 'max_height_residential_m', 'missing', 'high',
   'No height data extracted — same cause as lot size.'),
  ('waterloo-on', 'max_density_units_per_ha', 'missing', 'medium',
   'Density metric not found in ingested sections — may use different terminology.'),
  ('thunder-bay-on', 'permits_multiplex', 'missing', 'medium',
   'Multiplex permission not found in Thunder Bay Official Plan heading-based sections.'),
  ('thunder-bay-on', 'max_density_units_per_ha', 'missing', 'medium',
   'Density metric not found in Thunder Bay Official Plan.')
ON CONFLICT DO NOTHING;
