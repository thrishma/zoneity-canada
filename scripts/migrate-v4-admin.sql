-- Zoneity Canada — schema migration v4
-- 1. Unique constraint on bylaw_submissions.source_url (dedup community submissions)
-- 2. Unique constraint on bylaw_documents.source_url (dedup for ON CONFLICT upsert in ingest.py)
-- 3. Composite index for admin queue ordering
--
-- Before running (1): check for existing dupes:
--   SELECT source_url, COUNT(*) FROM bylaw_submissions GROUP BY source_url HAVING COUNT(*) > 1;
-- Before running (2): check for existing dupes:
--   SELECT source_url, COUNT(*) FROM bylaw_documents GROUP BY source_url HAVING COUNT(*) > 1;

ALTER TABLE bylaw_submissions
  ADD CONSTRAINT unique_submission_source_url UNIQUE (source_url);

ALTER TABLE bylaw_documents
  ADD CONSTRAINT unique_document_source_url UNIQUE (source_url);

-- Add updated_at to bylaw_documents if missing
ALTER TABLE bylaw_documents
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Composite index for admin queue — pending first, then newest
CREATE INDEX IF NOT EXISTS idx_submissions_status_created
  ON bylaw_submissions(status, created_at DESC);

-- municipalities unique on (name, province) for ON CONFLICT upsert from ingest.py
CREATE UNIQUE INDEX IF NOT EXISTS idx_municipalities_name_province
  ON municipalities(name, province);
