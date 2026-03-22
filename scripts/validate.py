#!/usr/bin/env python3
"""
Zoneity Canada — data quality validation pipeline.

Checks all ingested bylaw_metrics against validation rules, flags anomalies
into the data_quality_flags table, and prints a summary report.

Usage:
    python3 scripts/validate.py [--municipality waterloo-on] [--fix]

Options:
    --municipality   Only validate one municipality (default: all)
    --fix            Auto-resolve flags that are now populated (cleanup mode)
"""

import argparse
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

SCRIPT_DIR = Path(__file__).parent.resolve()
load_dotenv(SCRIPT_DIR.parent / "app" / ".env.local")

DB_URL = os.environ.get("SUPABASE_POSTGRES_TRANSACTION_POOLER") or os.environ.get(
    "SUPABASE_POSTGRES_URL"
)

# ── Metric validation rules ──────────────────────────────────────────────────
# Each rule: (metric_key, min, max, allowed_values)
# min/max apply to numeric metrics; allowed_values for boolean text fields.

NUMERIC_RANGES: dict[str, tuple[float, float]] = {
    "min_lot_size_sqm":          (50, 20_000),   # 50 sqm (micro-lot) → 20,000 sqm (2 ha)
    "max_height_residential_m":  (3, 200),        # 3m (single storey) → 200m (skyscraper)
    "min_parking_per_unit":      (0, 10),         # 0 (car-free) → 10 (very high)
    "max_density_units_per_ha":  (1, 2000),       # 1 (very low) → 2000 (high-rise district)
}

BOOLEAN_METRICS: set[str] = {"permits_secondary_suite", "permits_multiplex"}

EXPECTED_METRICS: list[str] = [
    "min_lot_size_sqm",
    "max_height_residential_m",
    "min_parking_per_unit",
    "permits_secondary_suite",
    "permits_multiplex",
    "max_density_units_per_ha",
]


@dataclass
class Flag:
    municipality_id: str
    metric_key: Optional[str]
    flag_type: str
    severity: str
    description: str


def validate_all(conn, municipality_filter: Optional[str] = None) -> list[Flag]:
    flags: list[Flag] = []
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    # Fetch all metrics
    where = "WHERE bm.municipality_id = %s" if municipality_filter else ""
    params = (municipality_filter,) if municipality_filter else ()
    cur.execute(
        f"""
        SELECT bm.municipality_id, m.name, bm.metric_key, bm.value, bm.updated_at
        FROM bylaw_metrics bm
        JOIN municipalities m ON m.id = bm.municipality_id
        {where}
        ORDER BY bm.municipality_id, bm.metric_key
        """,
        params,
    )
    rows = cur.fetchall()

    # Group by municipality
    by_municipality: dict[str, list] = {}
    for row in rows:
        by_municipality.setdefault(row["municipality_id"], []).append(row)

    # Fetch all municipalities
    cur.execute(
        "SELECT id, name FROM municipalities" + (" WHERE id = %s" if municipality_filter else ""),
        (municipality_filter,) if municipality_filter else (),
    )
    all_municipalities = {r["id"]: r["name"] for r in cur.fetchall()}

    for muni_id, muni_name in all_municipalities.items():
        muni_rows = by_municipality.get(muni_id, [])
        populated_keys = {r["metric_key"]: r["value"] for r in muni_rows}

        # 1. Missing metrics
        for metric_key in EXPECTED_METRICS:
            if metric_key not in populated_keys or populated_keys[metric_key] is None:
                flags.append(Flag(
                    municipality_id=muni_id,
                    metric_key=metric_key,
                    flag_type="missing",
                    severity="high" if metric_key in ("min_lot_size_sqm", "max_height_residential_m") else "medium",
                    description=(
                        f"{muni_name}: metric '{metric_key}' is not populated. "
                        "Bylaw may use different terminology or the section was not ingested."
                    ),
                ))

        # 2. Numeric range checks
        for metric_key, (min_val, max_val) in NUMERIC_RANGES.items():
            value = populated_keys.get(metric_key)
            if value is None:
                continue
            try:
                num = float(value.replace(",", ""))
            except (ValueError, AttributeError):
                flags.append(Flag(
                    municipality_id=muni_id,
                    metric_key=metric_key,
                    flag_type="anomaly",
                    severity="medium",
                    description=(
                        f"{muni_name}: '{metric_key}' has non-numeric value '{value}'. "
                        "Expected a number."
                    ),
                ))
                continue

            if not (min_val <= num <= max_val):
                flags.append(Flag(
                    municipality_id=muni_id,
                    metric_key=metric_key,
                    flag_type="anomaly",
                    severity="high",
                    description=(
                        f"{muni_name}: '{metric_key}' value {num} is outside expected range "
                        f"[{min_val}, {max_val}]. Likely an extraction error."
                    ),
                ))

        # 3. Boolean metric validation
        for metric_key in BOOLEAN_METRICS:
            value = populated_keys.get(metric_key)
            if value is None:
                continue
            if value.lower() not in ("yes", "no"):
                flags.append(Flag(
                    municipality_id=muni_id,
                    metric_key=metric_key,
                    flag_type="anomaly",
                    severity="medium",
                    description=(
                        f"{muni_name}: '{metric_key}' has unexpected value '{value}'. "
                        "Expected 'Yes' or 'No'."
                    ),
                ))

    cur.close()
    return flags


def write_flags(conn, flags: list[Flag], fix_mode: bool = False) -> tuple[int, int]:
    """Insert new flags, skip if already recorded. Returns (inserted, skipped)."""
    cur = conn.cursor()
    inserted = 0
    skipped = 0

    for flag in flags:
        # Check if this exact flag already exists and is unresolved
        cur.execute(
            """
            SELECT id FROM data_quality_flags
            WHERE municipality_id = %s
              AND (metric_key = %s OR (metric_key IS NULL AND %s IS NULL))
              AND flag_type = %s
              AND resolved = FALSE
            LIMIT 1
            """,
            (flag.municipality_id, flag.metric_key, flag.metric_key, flag.flag_type),
        )
        existing = cur.fetchone()
        if existing:
            skipped += 1
            continue

        cur.execute(
            """
            INSERT INTO data_quality_flags
              (municipality_id, metric_key, flag_type, severity, description)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (flag.municipality_id, flag.metric_key, flag.flag_type, flag.severity, flag.description),
        )
        inserted += 1

    if fix_mode:
        # Auto-resolve flags for metrics that are now populated
        cur.execute(
            """
            UPDATE data_quality_flags f
            SET resolved = TRUE, resolved_at = NOW()
            WHERE f.flag_type = 'missing'
              AND f.resolved = FALSE
              AND EXISTS (
                SELECT 1 FROM bylaw_metrics bm
                WHERE bm.municipality_id = f.municipality_id
                  AND bm.metric_key = f.metric_key
                  AND bm.value IS NOT NULL
              )
            """
        )
        resolved = cur.rowcount
        print(f"  Auto-resolved {resolved} flags (metrics now populated)")

    conn.commit()
    cur.close()
    return inserted, skipped


def print_report(flags: list[Flag]) -> None:
    if not flags:
        print("✓ No validation issues found.")
        return

    by_severity = {"high": [], "medium": [], "low": []}
    for f in flags:
        by_severity[f.severity].append(f)

    print(f"\nValidation report — {len(flags)} issues found")
    print("=" * 60)

    for severity in ("high", "medium", "low"):
        sflags = by_severity[severity]
        if not sflags:
            continue
        label = severity.upper()
        print(f"\n[{label}] {len(sflags)} issues")
        for f in sflags:
            metric_str = f" [{f.metric_key}]" if f.metric_key else ""
            print(f"  {f.flag_type.upper()}{metric_str}: {f.description}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Zoneity Canada — data quality validation")
    parser.add_argument("--municipality", help="Validate only this municipality ID")
    parser.add_argument("--fix", action="store_true", help="Auto-resolve flags for populated metrics")
    args = parser.parse_args()

    if not DB_URL:
        print("ERROR: SUPABASE_POSTGRES_TRANSACTION_POOLER not set", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(DB_URL)

    print(f"Running validation{' for ' + args.municipality if args.municipality else ' (all municipalities)'}...")
    flags = validate_all(conn, municipality_filter=args.municipality)
    print_report(flags)

    inserted, skipped = write_flags(conn, flags, fix_mode=args.fix)
    print(f"\nFlags written: {inserted} new, {skipped} already recorded")

    conn.close()


if __name__ == "__main__":
    main()
