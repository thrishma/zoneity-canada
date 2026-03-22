#!/usr/bin/env python3
"""
Ontario municipal bylaw scraper.

Discovers and downloads PDF bylaws from municipal websites, then registers
them in the bylaw_documents table for the ingest pipeline.

Usage:
    python3 scripts/scraper.py [--municipality waterloo-on] [--dry-run]

Supported municipalities:
    waterloo-on    City of Waterloo
    kitchener-on   City of Kitchener
    thunder-bay-on City of Thunder Bay
"""

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin, urlparse

import psycopg2
import psycopg2.extras
import requests
from dotenv import load_dotenv

SCRIPT_DIR = Path(__file__).parent.resolve()
load_dotenv(SCRIPT_DIR.parent / "app" / ".env.local")

DB_URL = os.environ.get("SUPABASE_POSTGRES_TRANSACTION_POOLER") or os.environ.get(
    "SUPABASE_POSTGRES_URL"
)

# ── Municipality catalogue ────────────────────────────────────────────────────
# Each entry maps to one or more landing pages. The scraper will crawl those
# pages looking for PDF links that match the bylaw_type patterns.

MUNICIPALITIES: dict[str, list[dict]] = {
    "waterloo-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.waterloo.ca/en/business/zoning-bylaw.aspx",
            "pdf_pattern": ["zoning", "bylaw"],
            "title_hint": "City of Waterloo Zoning By-law",
        },
        {
            "bylaw_type": "official_plan",
            "landing_url": "https://www.waterloo.ca/en/government/official-plan.aspx",
            "pdf_pattern": ["official", "plan"],
            "title_hint": "City of Waterloo Official Plan",
        },
    ],
    "kitchener-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.kitchener.ca/en/city-services/zoning-bylaw-2019-051.aspx",
            "pdf_pattern": ["zoning", "bylaw", "2019"],
            "title_hint": "City of Kitchener Zoning By-law 2019-051",
        },
        {
            "bylaw_type": "official_plan",
            "landing_url": "https://www.kitchener.ca/en/city-services/official-plan.aspx",
            "pdf_pattern": ["official", "plan"],
            "title_hint": "City of Kitchener Official Plan",
        },
    ],
    "thunder-bay-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.thunderbay.ca/en/city-services/zoning.aspx",
            "pdf_pattern": ["zoning"],
            "title_hint": "City of Thunder Bay Zoning By-law",
        },
    ],
}

HEADERS = {
    "User-Agent": (
        "OpenZoneCanada/1.0 (hackathon research project; "
        "contact: zoneity-canada@example.com)"
    )
}

DOWNLOAD_DIR = SCRIPT_DIR / "downloads"
RATE_LIMIT_SECS = 2.0  # be polite to municipal servers


# ── Helpers ───────────────────────────────────────────────────────────────────

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def find_pdf_links(html: str, base_url: str, patterns: list[str]) -> list[str]:
    """Extract PDF hrefs from raw HTML that contain all pattern strings (case-insensitive)."""
    import re

    hrefs = re.findall(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', html, re.IGNORECASE)
    results = []
    for href in hrefs:
        lower = href.lower()
        if all(p.lower() in lower for p in patterns):
            results.append(urljoin(base_url, href))
    return list(dict.fromkeys(results))  # deduplicate, preserve order


def download_pdf(url: str, dest: Path) -> Optional[Path]:
    """Download a PDF to dest. Returns path on success, None on failure."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=60, stream=True)
        resp.raise_for_status()
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb") as f:
            for chunk in resp.iter_content(65536):
                f.write(chunk)
        print(f"  Downloaded: {dest.name} ({dest.stat().st_size // 1024} KB)")
        return dest
    except requests.RequestException as e:
        print(f"  Warning: download failed for {url}: {e}", file=sys.stderr)
        return None


def register_document(
    conn: "psycopg2.connection",
    municipality_id: str,
    bylaw_type: str,
    title: str,
    source_url: str,
    local_path: str,
    version_hash: str,
    dry_run: bool,
) -> Optional[str]:
    """Upsert a bylaw_documents row. Returns the document UUID."""
    if dry_run:
        print(f"  [dry-run] Would register: {title}")
        return None

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO bylaw_documents
              (municipality_id, bylaw_type, title, source_url, local_path, version_hash)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT DO NOTHING
            RETURNING id
            """,
            (municipality_id, bylaw_type, title, source_url, local_path, version_hash),
        )
        row = cur.fetchone()
        if row:
            conn.commit()
            return str(row[0])

        # Already exists — check if hash changed (new version)
        cur.execute(
            "SELECT id, version_hash FROM bylaw_documents WHERE source_url = %s",
            (source_url,),
        )
        existing = cur.fetchone()
        if existing and existing[1] != version_hash:
            cur.execute(
                """
                INSERT INTO bylaw_change_log
                  (document_id, old_hash, new_hash, change_summary)
                VALUES (%s, %s, %s, %s)
                """,
                (existing[0], existing[1], version_hash, "PDF content changed"),
            )
            cur.execute(
                "UPDATE bylaw_documents SET version_hash = %s, last_checked_at = NOW() WHERE id = %s",
                (version_hash, existing[0]),
            )
            conn.commit()
            print(f"  Updated hash for existing document {existing[0]}")
        return str(existing[0]) if existing else None


# ── Main scraper ──────────────────────────────────────────────────────────────

def scrape_municipality(
    conn: "psycopg2.connection",
    municipality_id: str,
    dry_run: bool,
) -> list[dict]:
    """Scrape all bylaw documents for a municipality. Returns list of registered docs."""
    catalogue = MUNICIPALITIES.get(municipality_id)
    if not catalogue:
        print(f"Unknown municipality: {municipality_id}", file=sys.stderr)
        return []

    registered = []
    for entry in catalogue:
        print(f"\n[{municipality_id}] Checking {entry['bylaw_type']}...")
        print(f"  Fetching: {entry['landing_url']}")

        try:
            resp = requests.get(entry["landing_url"], headers=HEADERS, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as e:
            print(f"  Warning: could not fetch landing page: {e}", file=sys.stderr)
            continue

        time.sleep(RATE_LIMIT_SECS)

        pdf_urls = find_pdf_links(resp.text, entry["landing_url"], entry["pdf_pattern"])
        if not pdf_urls:
            print(f"  Warning: no PDF links found matching {entry['pdf_pattern']}")
            continue

        print(f"  Found {len(pdf_urls)} PDF candidate(s): {pdf_urls[:3]}")

        # Download the first (most prominent) match
        pdf_url = pdf_urls[0]
        filename = Path(urlparse(pdf_url).path).name or "bylaw.pdf"
        dest = DOWNLOAD_DIR / municipality_id / entry["bylaw_type"] / filename

        if dest.exists():
            print(f"  Already downloaded: {dest}")
            pdf_path = dest
        else:
            pdf_path = download_pdf(pdf_url, dest)

        if not pdf_path:
            continue

        version_hash = sha256_file(pdf_path)
        doc_id = register_document(
            conn=conn,
            municipality_id=municipality_id,
            bylaw_type=entry["bylaw_type"],
            title=entry["title_hint"],
            source_url=pdf_url,
            local_path=str(pdf_path),
            version_hash=version_hash,
            dry_run=dry_run,
        )

        registered.append({
            "municipality_id": municipality_id,
            "bylaw_type": entry["bylaw_type"],
            "document_id": doc_id,
            "local_path": str(pdf_path),
        })

        time.sleep(RATE_LIMIT_SECS)

    return registered


def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape Ontario municipal bylaws")
    parser.add_argument(
        "--municipality",
        help="Municipality id to scrape (omit to scrape all)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Discover and download PDFs but do not write to DB",
    )
    args = parser.parse_args()

    targets = [args.municipality] if args.municipality else list(MUNICIPALITIES.keys())

    conn = None
    if not args.dry_run:
        if not DB_URL:
            print("Error: SUPABASE_POSTGRES_TRANSACTION_POOLER or SUPABASE_POSTGRES_URL required", file=sys.stderr)
            sys.exit(1)
        conn = psycopg2.connect(DB_URL)

    all_registered = []
    for municipality_id in targets:
        docs = scrape_municipality(conn, municipality_id, args.dry_run)
        all_registered.extend(docs)

    if conn:
        conn.close()

    print(f"\nDone. Registered {len(all_registered)} document(s).")
    if all_registered:
        print(json.dumps(all_registered, indent=2))


if __name__ == "__main__":
    main()
