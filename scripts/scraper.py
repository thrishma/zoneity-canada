#!/usr/bin/env python3
"""
Ontario municipal bylaw scraper.

Discovers and downloads PDF bylaws from municipal websites, then registers
them in the bylaw_documents table for the ingest pipeline.

Usage:
    python3 scripts/scraper.py [--municipality waterloo-on] [--dry-run]

Supported municipalities (18 Ontario cities):
    Waterloo Region:      waterloo-on, kitchener-on, cambridge-on, guelph-on
    Northwestern ON:      thunder-bay-on
    Greater Toronto Area: mississauga-on, brampton-on, hamilton-on, markham-on,
                          richmond-hill-on, barrie-on, oshawa-on
    Southwestern ON:      london-on, windsor-on
    National Capital:     ottawa-on
    Eastern ON:           kingston-on
    Halton Region:        burlington-on, oakville-on
    Northern ON:          sudbury-on
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
    # ── Waterloo Region ──────────────────────────────────────────────────────
    "waterloo-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.waterloo.ca/en/government/zoning-bylaw.aspx",
            "pdf_pattern": ["zoning", "by-law"],
            "title_hint": "City of Waterloo Zoning By-law 2018-050",
            "direct_pdf_url": "https://www.waterloo.ca/media/ybpnbhdm/zoning-by-law-2018-050.pdf",
        },
        {
            "bylaw_type": "official_plan",
            "landing_url": "https://www.waterloo.ca/en/government/official-plan.aspx",
            "pdf_pattern": ["official", "plan"],
            "title_hint": "City of Waterloo Official Plan",
            "direct_pdf_url": "https://www.waterloo.ca/media/kq3nhow4/city-waterloo-official-plan.pdf",
        },
    ],
    "kitchener-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.kitchener.ca/development-and-construction/zoning/zoning-bylaw/",
            "pdf_pattern": ["crozby", "signed"],
            "title_hint": "City of Kitchener Zoning By-law 2019-051",
            "direct_pdf_url": "https://www.kitchener.ca/media/fcwplpb2/dsd_plan_crozby_signed_by-law.pdf",
        },
        {
            "bylaw_type": "official_plan",
            "landing_url": "https://www.kitchener.ca/development-and-construction/official-plan/",
            "pdf_pattern": ["official_plan", "2014"],
            "title_hint": "City of Kitchener Official Plan",
            "direct_pdf_url": "https://www.kitchener.ca/media/xxanre4z/dsd_plan_city_of_kitchener_official_plan_2014.pdf",
        },
    ],
    "cambridge-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.cambridge.ca/en/building-and-development/zoning-by-law.aspx",
            "pdf_pattern": ["zoning", "by-law", "150-16"],
            "title_hint": "City of Cambridge Zoning By-law 150-16",
            "direct_pdf_url": "https://www.cambridge.ca/en/building-and-development/resources/Zoning-By-law/ZBL-150-16-MARCH-2024.pdf",
        },
    ],
    "guelph-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://guelph.ca/living/housing-and-neighbourhood/zoning-bylaw/",
            "pdf_pattern": ["zoning", "bylaw"],
            "title_hint": "City of Guelph Zoning By-law",
            "direct_pdf_url": "https://guelph.ca/wp-content/uploads/ZoningBylaw_2023.pdf",
        },
        {
            "bylaw_type": "official_plan",
            "landing_url": "https://guelph.ca/living/housing-and-neighbourhood/official-plan/",
            "pdf_pattern": ["official", "plan"],
            "title_hint": "City of Guelph Official Plan",
            "direct_pdf_url": "https://guelph.ca/wp-content/uploads/Guelph-Official-Plan-2023.pdf",
        },
    ],
    # ── Northwestern Ontario ─────────────────────────────────────────────────
    "thunder-bay-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.thunderbay.ca/en/business/find-zoning-and-property-information.aspx",
            "pdf_pattern": ["zoning", "by-law", "1-2022"],
            "title_hint": "City of Thunder Bay Zoning By-law 1-2022",
            "direct_pdf_url": "https://www.thunderbay.ca/en/business/resources/Documents/Building-and-Planning/Zoning/Zoning-By-law-1-2022---Accessible---Office-Consolidation-to-May-27-2024.pdf",
        },
        {
            "bylaw_type": "official_plan",
            "landing_url": "https://www.thunderbay.ca/en/business/find-zoning-and-property-information.aspx",
            "pdf_pattern": ["official", "plan"],
            "title_hint": "City of Thunder Bay Official Plan",
            "direct_pdf_url": "https://www.thunderbay.ca/en/business/resources/Documents/Building-and-Planning/Official-Plan/Official-Plan---Amended-August-26-2024.pdf",
        },
    ],
    # ── Greater Toronto Area ─────────────────────────────────────────────────
    "mississauga-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.mississauga.ca/business-in-mississauga/planning-and-development/planning-documents/zoning-by-law/",
            "pdf_pattern": ["zoning", "by-law", "0225"],
            "title_hint": "City of Mississauga Zoning By-law 0225-2007",
            "direct_pdf_url": "https://www.mississauga.ca/media/documents/zoning-by-law-0225-2007-consolidated.pdf",
        },
    ],
    "brampton-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.brampton.ca/EN/Business/LandDev/Zoning/Pages/Zoning-Bylaw.aspx",
            "pdf_pattern": ["zoning", "by-law"],
            "title_hint": "City of Brampton Zoning By-law",
            "direct_pdf_url": "https://www.brampton.ca/EN/Business/LandDev/Zoning/Documents/BramptonZoningBylaw.pdf",
        },
    ],
    "hamilton-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.hamilton.ca/government-information/by-laws-legislation/zoning-by-law",
            "pdf_pattern": ["zoning", "by-law", "6593"],
            "title_hint": "City of Hamilton Zoning By-law No. 6593",
            "direct_pdf_url": "https://www.hamilton.ca/sites/default/files/media/browser/2021-09-14/zoning-bylaw-6593-current.pdf",
        },
    ],
    # ── Southwestern Ontario ─────────────────────────────────────────────────
    "london-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.london.ca/business-development/planning-development/zoning/zoning-by-law",
            "pdf_pattern": ["zoning", "z.-1"],
            "title_hint": "City of London Zoning By-law Z.-1",
            "direct_pdf_url": "https://www.london.ca/sites/default/files/2022-07/ZoningBylaw-Z-1-August2022.pdf",
        },
    ],
    "windsor-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.citywindsor.ca/residents/buildingandproperty/Pages/Zoning-By-laws.aspx",
            "pdf_pattern": ["zoning", "by-law"],
            "title_hint": "City of Windsor Zoning By-law",
            "direct_pdf_url": "https://www.citywindsor.ca/sites/planning/PlanningDocuments/Zoning-Bylaw-8600.pdf",
        },
    ],
    # ── National Capital Region ──────────────────────────────────────────────
    "ottawa-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://ottawa.ca/en/planning-development-and-construction/official-plan/new-official-plan",
            "pdf_pattern": ["zoning", "by-law", "2008-250"],
            "title_hint": "City of Ottawa Zoning By-law 2008-250",
            "direct_pdf_url": "https://ottawa.ca/sites/default/files/2023-04/zoning-bylaw-2008-250-consolidation.pdf",
        },
    ],
    # ── Eastern Ontario ──────────────────────────────────────────────────────
    "kingston-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.cityofkingston.ca/city-government/policies-by-laws-and-fees/by-laws/zoning-by-law",
            "pdf_pattern": ["zoning", "by-law"],
            "title_hint": "City of Kingston Zoning By-law",
            "direct_pdf_url": "https://www.cityofkingston.ca/documents/10180/13248959/Kingston+Zoning+By-Law+2022-67+Consolidated.pdf",
        },
    ],
    # ── Halton Region ────────────────────────────────────────────────────────
    "burlington-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.burlington.ca/en/services-for-you/zoning.aspx",
            "pdf_pattern": ["zoning", "by-law", "2020"],
            "title_hint": "City of Burlington Zoning By-law 2020",
            "direct_pdf_url": "https://www.burlington.ca/en/services-for-you/resources/Zoning/2020-Comprehensive-Zoning-Bylaw.pdf",
        },
    ],
    "oakville-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.oakville.ca/business-development/planning-zoning/zoning-by-law/",
            "pdf_pattern": ["zoning", "by-law", "2014-014"],
            "title_hint": "Town of Oakville Zoning By-law 2014-014",
            "direct_pdf_url": "https://www.oakville.ca/assets/2014_plan/zoning_bylaw_2014-014_consolidated.pdf",
        },
    ],
    # ── York Region ──────────────────────────────────────────────────────────
    "markham-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.markham.ca/wps/portal/home/business/planning-and-development/development-services/zoning/",
            "pdf_pattern": ["zoning", "by-law", "304-87"],
            "title_hint": "City of Markham Zoning By-law 304-87",
            "direct_pdf_url": "https://www.markham.ca/wps/wcm/connect/markham/documents/zoning-bylaw-304-87-consolidated.pdf",
        },
    ],
    "richmond-hill-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.richmondhill.ca/en/build-and-invest/zoning-bylaw.aspx",
            "pdf_pattern": ["zoning", "bylaw"],
            "title_hint": "Town of Richmond Hill Zoning By-law",
            "direct_pdf_url": "https://www.richmondhill.ca/en/build-and-invest/resources/Documents/Zoning-By-law-Consolidated.pdf",
        },
    ],
    # ── Simcoe County ────────────────────────────────────────────────────────
    "barrie-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.barrie.ca/city-hall/planning-and-development/zoning-by-law",
            "pdf_pattern": ["zoning", "by-law", "2009"],
            "title_hint": "City of Barrie Zoning By-law 2009-141",
            "direct_pdf_url": "https://www.barrie.ca/sites/default/files/uploads/Planning/ZBL_2009-141_Consolidated.pdf",
        },
    ],
    # ── Durham Region ────────────────────────────────────────────────────────
    "oshawa-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.oshawa.ca/city-hall/zoning-by-law.asp",
            "pdf_pattern": ["zoning", "by-law", "60-94"],
            "title_hint": "City of Oshawa Zoning By-law 60-94",
            "direct_pdf_url": "https://www.oshawa.ca/city-hall/resources/Zoning-By-law-60-94-Consolidated.pdf",
        },
    ],
    # ── Northern Ontario ─────────────────────────────────────────────────────
    "sudbury-on": [
        {
            "bylaw_type": "zoning_bylaw",
            "landing_url": "https://www.greatersudbury.ca/city-hall/by-laws/zoning-by-law/",
            "pdf_pattern": ["zoning", "by-law", "2010-100z"],
            "title_hint": "City of Greater Sudbury Zoning By-law 2010-100Z",
            "direct_pdf_url": "https://www.greatersudbury.ca/media/documents/planning/Zoning-By-law-2010-100Z-Consolidated.pdf",
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
            if entry.get("direct_pdf_url"):
                print(f"  No pattern match — using direct_pdf_url")
                pdf_urls = [entry["direct_pdf_url"]]
            else:
                print(f"  Warning: no PDF links found matching {entry['pdf_pattern']}")
                continue

        print(f"  Found {len(pdf_urls)} PDF candidate(s): {pdf_urls[:3]}")

        # Prefer direct_pdf_url if specified (avoids stale pattern matches)
        pdf_url = entry.get("direct_pdf_url") or pdf_urls[0]
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
