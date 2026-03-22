#!/usr/bin/env python3
"""
OpenZone Canada — PDF ingestion pipeline.

Downloads, extracts, parses, embeds, and inserts bylaw documents into Supabase.

Usage:
    python3 scripts/ingest.py --document-id <uuid>
    python3 scripts/ingest.py --all          # ingest all pending documents
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import psycopg2
import psycopg2.extras
import requests
from dotenv import load_dotenv
from openai import OpenAI

sys.path.insert(0, str(Path(__file__).parent))

from extractors.docling_extractor import extract_with_docling
from parsers.ontario_parser import parse_ontario, parse_ontario_from_markdown

SCRIPT_DIR = Path(__file__).parent.resolve()
load_dotenv(SCRIPT_DIR.parent / "app" / ".env.local")

DB_URL = os.environ.get("SUPABASE_POSTGRES_TRANSACTION_POOLER") or os.environ.get(
    "SUPABASE_POSTGRES_URL"
)
SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]

EMBEDDING_MODEL = "text-embedding-3-small"
BATCH_SIZE = 10

openai_client = OpenAI(api_key=OPENAI_API_KEY)


# ── Embedding ─────────────────────────────────────────────────────────────────

def embed_texts(texts: list[str]) -> list[list[float]]:
    resp = openai_client.embeddings.create(model=EMBEDDING_MODEL, input=texts)
    return [d.embedding for d in resp.data]


# ── Ingest a single document ──────────────────────────────────────────────────

def ingest_document(conn: "psycopg2.connection", document_id: str) -> int:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT * FROM bylaw_documents WHERE id = %s",
            (document_id,),
        )
        doc = cur.fetchone()

    if not doc:
        print(f"Document {document_id} not found", file=sys.stderr)
        return 0

    print(f"\nIngesting: {doc['title']} ({doc['municipality_id']})")
    print(f"  Source: {doc['source_url']}")

    # Download if not already present
    local_path = Path(doc["local_path"]) if doc.get("local_path") else None
    if not local_path or not local_path.exists():
        print("  Downloading PDF...")
        local_path = SCRIPT_DIR / "downloads" / doc["municipality_id"] / f"{document_id}.pdf"
        local_path.parent.mkdir(parents=True, exist_ok=True)
        resp = requests.get(
            doc["source_url"],
            headers={"User-Agent": "OpenZoneCanada/1.0"},
            timeout=120,
            stream=True,
        )
        resp.raise_for_status()
        with open(local_path, "wb") as f:
            for chunk in resp.iter_content(65536):
                f.write(chunk)

    # Extract with Docling
    print("  Extracting with Docling...")
    blocks = extract_with_docling(str(local_path), document_id)
    print(f"  Extracted {len(blocks)} blocks")

    # Parse into sections
    sections = parse_ontario(blocks)
    print(f"  Parsed {len(sections)} sections")

    if not sections:
        print("  Warning: no sections parsed — check the PDF structure", file=sys.stderr)
        return 0

    # Delete existing sections for this document
    with conn.cursor() as cur:
        cur.execute("DELETE FROM bylaw_sections WHERE document_id = %s", (document_id,))

    # Embed and insert in batches
    inserted = 0
    for i in range(0, len(sections), BATCH_SIZE):
        batch = sections[i : i + BATCH_SIZE]
        texts = [s["text"] for s in batch]

        print(f"  Embedding batch {i // BATCH_SIZE + 1}/{-(-len(sections) // BATCH_SIZE)}...")
        embeddings = embed_texts(texts)
        time.sleep(0.5)  # OpenAI rate limit

        with conn.cursor() as cur:
            for section, embedding in zip(batch, embeddings):
                cur.execute(
                    """
                    INSERT INTO bylaw_sections
                      (document_id, municipality_id, chapter, chapter_name,
                       section, title, text, page, embedding)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::vector)
                    """,
                    (
                        document_id,
                        doc["municipality_id"],
                        section.get("chapter"),
                        section.get("chapter_name"),
                        section.get("section"),
                        section.get("title"),
                        section["text"],
                        section.get("page"),
                        json.dumps(embedding),
                    ),
                )
                inserted += 1

        conn.commit()

    print(f"  Inserted {inserted} sections")
    return inserted


# ── Metric extraction ─────────────────────────────────────────────────────────

METRIC_PROMPTS = {
    "min_lot_size_sqm": (
        "What is the minimum lot area or lot size in square metres for a single detached "
        "residential (R-1 or equivalent low-density) zone? Return just the number in sqm."
    ),
    "max_height_residential_m": (
        "What is the maximum building height in metres permitted in a low-density residential "
        "(R-1 or equivalent) zone? Return just the number in metres."
    ),
    "min_parking_per_unit": (
        "How many parking spaces are required per dwelling unit in a multi-unit residential "
        "building? Return just the number (e.g. 1.0, 1.5)."
    ),
    "permits_secondary_suite": (
        "Are secondary suites (accessory dwelling units, in-law suites) permitted as-of-right "
        "in low-density residential zones? Answer Yes or No."
    ),
    "permits_multiplex": (
        "Are multiplexes (4 or more dwelling units on a lot) permitted as-of-right in "
        "residential zones? Answer Yes or No."
    ),
    "max_density_units_per_ha": (
        "What is the maximum residential density in units per hectare in medium-density "
        "residential zones? Return just the number."
    ),
}


def extract_metrics(
    conn: "psycopg2.connection",
    municipality_id: str,
    document_id: str,
) -> None:
    """Use GPT to extract key metrics from the top bylaw sections and store in bylaw_metrics."""
    print(f"\nExtracting metrics for {municipality_id}...")

    # Get a sample of sections for context
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT section, title, text FROM bylaw_sections
            WHERE document_id = %s
            ORDER BY chapter NULLS LAST, section
            LIMIT 60
            """,
            (document_id,),
        )
        sections = cur.fetchall()

    context = "\n\n".join(
        f"Section {s['section']} — {s['title'] or ''}:\n{s['text'][:500]}"
        for s in sections
    )

    for metric_key, prompt in METRIC_PROMPTS.items():
        try:
            resp = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are extracting specific regulatory values from a municipal zoning bylaw. "
                            "Answer with only the requested value — no units, no explanation. "
                            "If you cannot find the answer, reply with: NOT_FOUND"
                        ),
                    },
                    {
                        "role": "user",
                        "content": f"BYLAW SECTIONS:\n{context[:4000]}\n\nQUESTION: {prompt}",
                    },
                ],
                max_tokens=30,
                temperature=0,
            )
            value = resp.choices[0].message.content.strip()
            if value == "NOT_FOUND":
                value = None

            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO bylaw_metrics (municipality_id, document_id, metric_key, value)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (municipality_id, metric_key) DO UPDATE
                      SET value = EXCLUDED.value, updated_at = NOW()
                    """,
                    (municipality_id, document_id, metric_key, value),
                )
            conn.commit()
            print(f"  {metric_key}: {value}")

        except Exception as e:
            print(f"  Warning: failed to extract {metric_key}: {e}", file=sys.stderr)

        time.sleep(0.3)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest bylaw PDFs into OpenZone Canada DB")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--document-id", help="UUID of a bylaw_documents row to ingest")
    group.add_argument("--all", action="store_true", help="Ingest all registered documents")
    parser.add_argument("--skip-metrics", action="store_true", help="Skip metric extraction")
    args = parser.parse_args()

    if not DB_URL:
        print("Error: database URL not configured", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(DB_URL)

    if args.all:
        with conn.cursor() as cur:
            cur.execute("SELECT id, municipality_id FROM bylaw_documents ORDER BY ingested_at")
            docs = cur.fetchall()
        for doc_id, municipality_id in docs:
            count = ingest_document(conn, str(doc_id))
            if count > 0 and not args.skip_metrics:
                extract_metrics(conn, municipality_id, str(doc_id))
    else:
        count = ingest_document(conn, args.document_id)
        if count > 0 and not args.skip_metrics:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT municipality_id FROM bylaw_documents WHERE id = %s",
                    (args.document_id,),
                )
                row = cur.fetchone()
            if row:
                extract_metrics(conn, row[0], args.document_id)

    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
