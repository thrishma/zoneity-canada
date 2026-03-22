-- Zoneity Canada — schema migration v3
-- Adds community bylaw submission table.

CREATE TABLE IF NOT EXISTS bylaw_submissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Municipality info (may be existing or new)
  municipality_id   TEXT REFERENCES municipalities(id),  -- null if new municipality
  municipality_name TEXT NOT NULL,  -- always filled, even for existing
  province          TEXT NOT NULL,

  -- Document metadata
  bylaw_type        TEXT NOT NULL CHECK (bylaw_type IN (
                      'zoning_bylaw', 'official_plan', 'parking_bylaw',
                      'site_plan_bylaw', 'other')),
  title             TEXT NOT NULL,
  source_url        TEXT,           -- webpage or direct PDF URL
  notes             TEXT,           -- submitter context / hints

  -- Submitter (optional)
  submitter_name    TEXT,
  submitter_email   TEXT,

  -- Review workflow
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'reviewed', 'ingesting', 'ingested', 'rejected')),
  review_notes      TEXT,
  reviewed_at       TIMESTAMPTZ,
  ingested_at       TIMESTAMPTZ,

  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_submissions_status           ON bylaw_submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_municipality_id  ON bylaw_submissions(municipality_id);
CREATE INDEX IF NOT EXISTS idx_submissions_created_at       ON bylaw_submissions(created_at DESC);
