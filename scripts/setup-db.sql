-- Zoneity Canada — database schema
-- Run against a fresh Supabase project.

-- Enable vector search
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Municipalities ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS municipalities (
  id           TEXT PRIMARY KEY,   -- e.g. "waterloo-on"
  name         TEXT NOT NULL,      -- e.g. "Waterloo"
  province     TEXT NOT NULL,      -- e.g. "ON"
  population   INTEGER,
  website      TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Ontario municipalities
INSERT INTO municipalities (id, name, province, population, website) VALUES
  ('waterloo-on',    'Waterloo',    'ON', 121436,  'https://www.waterloo.ca'),
  ('kitchener-on',   'Kitchener',   'ON', 256885,  'https://www.kitchener.ca'),
  ('thunder-bay-on', 'Thunder Bay', 'ON', 110172,  'https://www.thunderbay.ca')
ON CONFLICT (id) DO NOTHING;

-- ── Bylaw documents ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bylaw_documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id  TEXT NOT NULL REFERENCES municipalities(id),
  bylaw_type       TEXT NOT NULL CHECK (bylaw_type IN (
                     'zoning_bylaw', 'official_plan', 'parking_bylaw',
                     'site_plan_bylaw', 'other')),
  title            TEXT NOT NULL,
  source_url       TEXT NOT NULL,
  local_path       TEXT,
  version_hash     TEXT,            -- SHA-256 of the downloaded PDF
  ingested_at      TIMESTAMPTZ DEFAULT NOW(),
  last_checked_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bylaws_municipality ON bylaw_documents(municipality_id);
CREATE INDEX IF NOT EXISTS idx_bylaws_type ON bylaw_documents(bylaw_type);

-- ── Bylaw sections (one row per parsed clause/section) ────────────────────────

CREATE TABLE IF NOT EXISTS bylaw_sections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES bylaw_documents(id) ON DELETE CASCADE,
  municipality_id TEXT NOT NULL REFERENCES municipalities(id),
  chapter         INTEGER,
  chapter_name    TEXT,
  section         TEXT,
  title           TEXT,
  text            TEXT NOT NULL,
  page            INTEGER,
  embedding       vector(1536),     -- text-embedding-3-small
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sections_document   ON bylaw_sections(document_id);
CREATE INDEX IF NOT EXISTS idx_sections_municipality ON bylaw_sections(municipality_id);
CREATE INDEX IF NOT EXISTS idx_sections_embedding  ON bylaw_sections
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- ── Bylaw metrics (structured key/value for comparison) ───────────────────────
-- Populated by the ingest pipeline after parsing. Allows fast comparison queries
-- without re-running semantic search.

CREATE TABLE IF NOT EXISTS bylaw_metrics (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id  TEXT NOT NULL REFERENCES municipalities(id),
  document_id      UUID REFERENCES bylaw_documents(id),
  metric_key       TEXT NOT NULL,
  value            TEXT,
  source_section   TEXT,           -- section number the value was extracted from
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (municipality_id, metric_key)
);

CREATE INDEX IF NOT EXISTS idx_metrics_municipality ON bylaw_metrics(municipality_id);
CREATE INDEX IF NOT EXISTS idx_metrics_key          ON bylaw_metrics(metric_key);

-- ── Change log (track bylaw updates over time) ────────────────────────────────

CREATE TABLE IF NOT EXISTS bylaw_change_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES bylaw_documents(id),
  detected_at     TIMESTAMPTZ DEFAULT NOW(),
  old_hash        TEXT,
  new_hash        TEXT,
  change_summary  TEXT
);
