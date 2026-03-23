-- Zoneity Canada — schema migration v5
-- Open Data ingestion: Waterloo Region datasets from data.waterloo.ca
-- Generic feature table to hold GeoJSON features from multiple ArcGIS datasets

CREATE TABLE IF NOT EXISTS open_data_features (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_name  TEXT         NOT NULL,   -- e.g. 'building_permits', 'landmarks'
  dataset_label TEXT         NOT NULL,   -- Human-readable label
  municipality  TEXT         NOT NULL DEFAULT 'waterloo-region',
  feature_id    TEXT,                    -- Original ID from source dataset
  properties    JSONB        NOT NULL DEFAULT '{}',
  geometry      JSONB,                   -- GeoJSON geometry object (type + coordinates)
  source_url    TEXT,                    -- ArcGIS FeatureServer URL queried
  ingested_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Fast lookup by dataset
CREATE INDEX IF NOT EXISTS idx_open_data_dataset ON open_data_features(dataset_name);

-- Fast lookup by municipality
CREATE INDEX IF NOT EXISTS idx_open_data_municipality ON open_data_features(municipality);

-- GIN index on properties for JSONB key/value filtering
CREATE INDEX IF NOT EXISTS idx_open_data_properties ON open_data_features USING GIN(properties);

-- Dedup: one feature per (dataset, feature_id) — allows re-runs to upsert safely
CREATE UNIQUE INDEX IF NOT EXISTS idx_open_data_dedup
  ON open_data_features(dataset_name, feature_id)
  WHERE feature_id IS NOT NULL;

COMMENT ON TABLE open_data_features IS
  'Open data features ingested from data.waterloo.ca ArcGIS Hub — building permits, landmarks, planning communities, neighbourhood associations, address proximity';
