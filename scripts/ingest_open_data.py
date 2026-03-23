#!/usr/bin/env python3
"""
ingest_open_data.py — Fetch open datasets from data.waterloo.ca (ArcGIS Hub)
and store them in the open_data_features table.

Usage:
  python ingest_open_data.py                  # ingest all configured datasets
  python ingest_open_data.py --dataset building_permits
  python ingest_open_data.py --list           # show available datasets
  python ingest_open_data.py --dry-run        # fetch + count, no DB writes

Datasets ingested:
  - building_permits         City of Waterloo building permits (32k records)
  - planning_communities     Kitchener planning community boundaries
  - neighbourhood_assoc      City of Waterloo neighbourhood association boundaries
  - landmarks                Kitchener landmarks (schools, parks, services, POIs)
  - address_proximity        Kitchener address proximity to nearest amenities
"""

import argparse
import json
import os
import sys
import time
from typing import Any

import psycopg2
import psycopg2.extras
import requests
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "../app/.env.local"))

DB_URL = os.environ.get("SUPABASE_POSTGRES_TRANSACTION_POOLER") or os.environ.get(
    "SUPABASE_POSTGRES_URL"
)
if not DB_URL:
    sys.exit("ERROR: Set SUPABASE_POSTGRES_TRANSACTION_POOLER in app/.env.local")

PAGE_SIZE = 1000        # ArcGIS default max; some services cap at 2000
REQUEST_TIMEOUT = 30   # seconds
RETRY_DELAY = 3        # seconds between retries
MAX_RETRIES = 3

# ---------------------------------------------------------------------------
# Dataset registry
# Each entry maps to one ArcGIS FeatureServer layer.
# The Hub API resolves slug → featureServiceUrl automatically.
# ---------------------------------------------------------------------------

DATASETS: dict[str, dict[str, Any]] = {
    "building_permits": {
        "label": "City of Waterloo Building Permits",
        "municipality": "waterloo-on",
        # Resolved from ArcGIS item 9319ff78ff074327acb9e2e084e30b2c
        "feature_server_url": "https://services.arcgis.com/ZpeBVw5o1kjit7LT/arcgis/rest/services/City_of_Waterloo_Building_Permits/FeatureServer/0",
        "id_field": "OBJECTID",
    },
    "planning_communities": {
        "label": "Kitchener Planning Communities",
        "municipality": "kitchener-on",
        # Resolved from ArcGIS item 5beaad88d83d4e9f92640a6dd79387a8
        "feature_server_url": "https://services1.arcgis.com/qAo1OsXi67t7XgmS/arcgis/rest/services/Planning_Communities/FeatureServer/0",
        "id_field": "OBJECTID",
    },
    "neighbourhood_assoc": {
        "label": "City of Waterloo Neighbourhood Associations",
        "municipality": "waterloo-on",
        # Resolved from ArcGIS item 50193e4f74d949479b048cf445d6dd82
        "feature_server_url": "https://services.arcgis.com/ZpeBVw5o1kjit7LT/arcgis/rest/services/NeighbourhoodAssociations/FeatureServer/0",
        "id_field": "OBJECTID",
    },
    "landmarks": {
        "label": "Kitchener Landmarks",
        "municipality": "kitchener-on",
        # Resolved from ArcGIS item 5dbeed2b0f5e4905934436709b4ac7f8
        "feature_server_url": "https://services1.arcgis.com/qAo1OsXi67t7XgmS/arcgis/rest/services/Landmarks/FeatureServer/0",
        "id_field": "OBJECTID",
    },
    "address_proximity": {
        "label": "Kitchener Address Proximity Directory",
        "municipality": "kitchener-on",
        # Resolved from ArcGIS item 91b34c8560c04dcdbc262361e2995bad
        "feature_server_url": "https://services1.arcgis.com/qAo1OsXi67t7XgmS/arcgis/rest/services/Address_Proximity_Directory/FeatureServer/0",
        "id_field": "OBJECTID",
    },
}

# ---------------------------------------------------------------------------
# ArcGIS FeatureServer helpers
# ---------------------------------------------------------------------------

def resolve_feature_server_url(dataset_key: str, cfg: dict) -> str | None:
    """Return the hardcoded FeatureServer URL for this dataset."""
    fs_url = cfg.get("feature_server_url")
    if not fs_url:
        print(f"  ERROR: No feature_server_url configured for {dataset_key}")
    return fs_url


def fetch_page(fs_url: str, offset: int, page_size: int) -> list[dict]:
    """Fetch one page of GeoJSON features from an ArcGIS FeatureServer."""
    params = {
        "where": "1=1",
        "outFields": "*",
        "returnGeometry": "true",
        "f": "geojson",
        "resultOffset": offset,
        "resultRecordCount": page_size,
    }
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.get(
                f"{fs_url}/query", params=params, timeout=REQUEST_TIMEOUT
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("features", [])
        except Exception as exc:
            if attempt == MAX_RETRIES:
                print(f"    ERROR: {exc} (giving up after {MAX_RETRIES} attempts)")
                return []
            print(f"    WARN: {exc} — retrying in {RETRY_DELAY}s...")
            time.sleep(RETRY_DELAY)
    return []


def fetch_all_features(fs_url: str, page_size: int = PAGE_SIZE) -> list[dict]:
    """Paginate through all features in a FeatureServer layer."""
    all_features: list[dict] = []
    offset = 0
    while True:
        page = fetch_page(fs_url, offset, page_size)
        all_features.extend(page)
        print(f"    fetched {len(all_features)} features so far...", end="\r")
        if len(page) < page_size:
            break  # last page
        offset += page_size
        time.sleep(0.2)  # be polite
    print()
    return all_features

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db_conn():
    return psycopg2.connect(DB_URL)


def ensure_table(conn):
    """Run the migration if the table doesn't exist yet."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name = 'open_data_features'
            )
        """)
        exists = cur.fetchone()[0]
    if not exists:
        migration_path = os.path.join(os.path.dirname(__file__), "migrate-v5-open-data.sql")
        with open(migration_path) as f:
            sql = f.read()
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
        print("  [db] Created open_data_features table")


def upsert_features(
    conn,
    dataset_name: str,
    dataset_label: str,
    municipality: str,
    features: list[dict],
    fs_url: str,
    id_field: str,
    dry_run: bool = False,
) -> int:
    """Upsert a list of GeoJSON features into open_data_features."""
    if dry_run:
        return len(features)

    rows = []
    for feat in features:
        props: dict = feat.get("properties") or {}
        geom = feat.get("geometry")
        feature_id = str(props.get(id_field, "")) or None

        rows.append({
            "dataset_name": dataset_name,
            "dataset_label": dataset_label,
            "municipality": municipality,
            "feature_id": feature_id,
            "properties": json.dumps(props),
            "geometry": json.dumps(geom) if geom else None,
            "source_url": fs_url,
        })

    upsert_sql = """
        INSERT INTO open_data_features
          (dataset_name, dataset_label, municipality, feature_id, properties, geometry, source_url)
        VALUES
          (%(dataset_name)s, %(dataset_label)s, %(municipality)s, %(feature_id)s,
           %(properties)s::jsonb, %(geometry)s::jsonb, %(source_url)s)
        ON CONFLICT (dataset_name, feature_id)
        WHERE feature_id IS NOT NULL
        DO UPDATE SET
          properties  = EXCLUDED.properties,
          geometry    = EXCLUDED.geometry,
          dataset_label = EXCLUDED.dataset_label,
          source_url  = EXCLUDED.source_url,
          ingested_at = NOW()
    """
    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, upsert_sql, rows, page_size=500)
    conn.commit()
    return len(rows)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def ingest_dataset(key: str, cfg: dict, conn, dry_run: bool) -> None:
    print(f"\n[{key}] {cfg['label']}")

    fs_url = resolve_feature_server_url(key, cfg)
    if not fs_url:
        print(f"  ERROR: Could not resolve FeatureServer URL for {key} — skipping")
        return

    print(f"  Fetching from: {fs_url}")
    features = fetch_all_features(fs_url)
    print(f"  Total features: {len(features)}")

    if not features:
        print("  No features returned — skipping DB write")
        return

    count = upsert_features(
        conn=conn,
        dataset_name=key,
        dataset_label=cfg["label"],
        municipality=cfg["municipality"],
        features=features,
        fs_url=fs_url,
        id_field=cfg.get("id_field", "OBJECTID"),
        dry_run=dry_run,
    )
    action = "would insert/update" if dry_run else "upserted"
    print(f"  {action} {count} rows")


def main():
    parser = argparse.ArgumentParser(description="Ingest Waterloo open data into Supabase")
    parser.add_argument("--dataset", help="Single dataset key to ingest")
    parser.add_argument("--list", action="store_true", help="List available datasets")
    parser.add_argument("--dry-run", action="store_true", help="Fetch but don't write to DB")
    args = parser.parse_args()

    if args.list:
        print("Available datasets:")
        for key, cfg in DATASETS.items():
            print(f"  {key:<25} {cfg['label']}")
        return

    targets = {}
    if args.dataset:
        if args.dataset not in DATASETS:
            sys.exit(f"ERROR: Unknown dataset '{args.dataset}'. Run --list to see options.")
        targets = {args.dataset: DATASETS[args.dataset]}
    else:
        targets = DATASETS

    conn = get_db_conn()
    ensure_table(conn)

    for key, cfg in targets.items():
        ingest_dataset(key, cfg, conn, dry_run=args.dry_run)

    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
