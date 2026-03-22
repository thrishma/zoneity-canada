#!/usr/bin/env python3
"""
Zoneity Canada — PDF ingestion pipeline.

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

MAX_CHARS = 12000  # conservative truncation — table-heavy bylaw text can be 2-3 chars/token

def embed_texts(texts: list[str]) -> list[list[float]]:
    truncated = [t[:MAX_CHARS] for t in texts]
    resp = openai_client.embeddings.create(model=EMBEDDING_MODEL, input=truncated)
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
    blocks, _markdown = extract_with_docling(str(local_path), document_id, conn, document_id)
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

# Regex patterns applied to raw PDF text before falling back to LLM.
# Each pattern should capture a numeric value or Yes/No from the bylaw text.
METRIC_REGEX: dict[str, list[str]] = {
    "min_lot_size_sqm": [
        # Ontario style: "LOT AREA (minimum)\nINTERIOR LOT: 405 square metres"
        r"LOT AREA\s*\(minimum\)[\s\S]{0,80}?INTERIOR LOT[:\s]+(\d[\d,\.]+)\s*square metres",
        # Ontario style anchored to R1/Residential One table
        r"(?:R1|Residential One)[\s\S]{0,500}?LOT AREA\s*\(minimum\)[\s\S]{0,80}?(\d{3,6})\s*square metres",
        # Thunder Bay style: "Minimum lot area\n540 m2"
        r"Minimum lot area\s*\n\s*(\d[\d,\.]+)\s*m2",
        r"Minimum\s+lot\s+area\s*[\n\t:]\s*(\d[\d,\.]+)\s*m(?:2|²|etres|etre)?",
        # Generic
        r"minimum\s+lot\s+area\s+(?:is\s+|of\s+)?(\d[\d,\.]+)\s*(?:square metres|sq\.?\s*m|m2|m²)",
    ],
    "max_height_residential_m": [
        # Ontario style anchored to R1 table (avoid accessory building matches)
        r"(?:R1|Residential One)[\s\S]{0,800}?BUILDING HEIGHT\s*\(maximum\)[\s\S]{0,80}?(\d{1,2}[\.,]\d{0,2})\s*metres",
        # Thunder Bay style: "Maximum height\n10.0 m"
        r"Maximum\s+height\s*\n\s*(\d+\.?\d*)\s*(?:m|metres|storeys)",
        r"Maximum\s+height[\s\t:]+(\d+\.?\d*)\s*(?:m|metres)",
        # Generic
        r"maximum building height[^\n]{0,80}?(\d[\d,\.]+)\s*metres",
    ],
    "min_parking_per_unit": [
        # Ontario table: "One (1) DWELLING UNIT: One (1) PARKING SPACE" → capture "1"
        r"One\s+\((\d)\)\s+DWELLING UNIT[:\s]+One\s+\(\d\)\s+PARKING SPACE",
        r"(\d[\d,\.]+)\s*parking\s+space[s]?\s+per\s+(?:dwelling\s+)?unit",
        r"(\d[\d,\.]+)\s+space[s]?\s+per\s+(?:dwelling\s+)?unit",
        r"per\s+(?:dwelling\s+)?unit[,:\s]+(\d[\d,\.]+)\s*(?:space|parking)",
    ],
    "permits_secondary_suite": [
        r"(?:secondary suite|accessory dwelling unit|additional residential unit|in-law suite)[^\n]{0,300}(?:permitted|allowed|as[- ]of[- ]right)",
        r"(?:secondary suite|accessory dwelling unit|additional residential unit)[^\n]{0,100}permitted",
    ],
    "permits_multiplex": [
        r"(?:multiplex|4[\s-]?or[\s-]?more[\s-]?unit|four[\s-]?unit)[^\n]{0,300}(?:permitted|allowed|as[- ]of[- ]right)",
        r"(?:apartment|multi.?unit)[^\n]{0,50}(?:4|four)\s+or\s+more[^\n]{0,100}permitted",
    ],
    "max_density_units_per_ha": [
        r"(\d[\d,\.]+)\s+(?:units?|dwelling units?|du)\s+per\s+(?:net\s+)?hectare",
        r"(\d[\d,\.]+)\s+(?:units?|du)\s*/\s*ha(?:ctare)?",
        r"Maximum\s+density\s*[\n\t:]\s*(\d[\d,\.]+)\s*(?:units?|du)",
    ],
}


def _try_regex_metrics(pdf_path: str) -> dict[str, str | None]:
    """
    Fast regex scan of raw PDF text for common metric patterns.
    Returns a dict of metric_key → extracted value (or None).
    """
    try:
        import fitz
        import re

        doc = fitz.open(pdf_path)
        # Concatenate first 250 pages (regulations are usually at the front)
        raw_text = ""
        for page in doc:
            if page.number > 250:
                break
            raw_text += page.get_text() + "\n"
        doc.close()

        results: dict[str, str | None] = {}
        for metric_key, patterns in METRIC_REGEX.items():
            found = None
            for pat in patterns:
                m = re.search(pat, raw_text, re.IGNORECASE | re.DOTALL)
                if m:
                    if m.lastindex:
                        found = m.group(1).replace(",", "").strip()
                    else:
                        # Boolean pattern — just confirm presence
                        found = "Yes"
                    break
            results[metric_key] = found
        return results
    except Exception as e:
        print(f"  Warning: regex extraction failed: {e}", file=sys.stderr)
        return {}


def extract_metrics(
    conn: "psycopg2.connection",
    municipality_id: str,
    document_id: str,
) -> None:
    """
    Use semantic search + GPT to extract key metrics from bylaw sections.

    For each metric, embeds the question, finds the most relevant sections via
    cosine similarity, and feeds those as context to GPT-4o-mini.
    """
    print(f"\nExtracting metrics for {municipality_id}...")

    import json as _json

    # Step 1: fast regex scan on raw PDF text
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT local_path FROM bylaw_documents WHERE id = %s", (document_id,))
        doc_row = cur.fetchone()
    local_path = doc_row["local_path"] if doc_row else None
    regex_results = _try_regex_metrics(local_path) if local_path else {}
    if regex_results:
        hits = {k: v for k, v in regex_results.items() if v is not None}
        print(f"  Regex found {len(hits)}/{len(METRIC_PROMPTS)} metrics: {list(hits.keys())}")

    for metric_key, prompt in METRIC_PROMPTS.items():
        # Use regex result if available, skip LLM call
        if regex_results.get(metric_key) is not None:
            value = regex_results[metric_key]
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
            print(f"  {metric_key}: {value} (regex)")
            continue
        try:
            # Build context from raw PDF text using keyword-anchored windows
            context = ""
            keywords_map = {
                "min_lot_size_sqm": ["lot area", "residential one", "R1", "table 7a", "table 1"],
                "max_height_residential_m": ["building height", "residential one", "R1", "table 7a"],
                "min_parking_per_unit": ["parking space", "dwelling unit", "per unit", "parking requirement"],
                "permits_secondary_suite": ["secondary suite", "additional residential unit", "accessory apartment", "accessory dwelling"],
                "permits_multiplex": ["multiplex", "4 or more unit", "four-unit", "four unit"],
                "max_density_units_per_ha": ["units per hectare", "density", "du/ha", "dwelling units per"],
            }
            if local_path:
                try:
                    import fitz as _fitz
                    _doc = _fitz.open(local_path)
                    _raw = "\n".join(_p.get_text() for i, _p in enumerate(_doc) if i < 300)
                    _doc.close()
                    kws = keywords_map.get(metric_key, [])
                    for kw in kws:
                        idx = _raw.lower().find(kw.lower())
                        if idx >= 0:
                            context = _raw[max(0, idx - 100): idx + 3000]
                            break
                    if not context:
                        context = _raw[:3000]
                except Exception:
                    pass

            # Fallback: semantic search over embedded sections
            if not context:
                q_embedding = embed_texts([prompt])[0]
                vector_literal = f"[{','.join(str(x) for x in q_embedding)}]"
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(
                        """
                        SELECT section, title, text
                        FROM bylaw_sections
                        WHERE document_id = %s AND embedding IS NOT NULL
                        ORDER BY embedding <=> %s::vector LIMIT 6
                        """,
                        (document_id, vector_literal),
                    )
                    context = "\n\n".join(
                        f"Section {s['section']} — {s['title'] or ''}:\n{s['text'][:600]}"
                        for s in cur.fetchall()
                    )

            if not context:
                print(f"  {metric_key}: SKIP (no context)")
                continue

            resp = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are extracting specific regulatory values from a municipal zoning bylaw. "
                            "Answer with only the requested value — no units, no explanation. "
                            "If you cannot find the answer in the provided sections, reply with: NOT_FOUND"
                        ),
                    },
                    {
                        "role": "user",
                        "content": f"BYLAW SECTIONS (most relevant first):\n{context}\n\nQUESTION: {prompt}",
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
    parser = argparse.ArgumentParser(description="Ingest bylaw PDFs into Zoneity Canada DB")
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
