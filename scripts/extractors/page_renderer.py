#!/usr/bin/env python3
"""
Page renderer — renders PDF pages to PNG images using pymupdf (fitz).

Uses pymupdf because it handles non-standard font encodings that break
Docling (e.g. NBC PDFs with CID font maps).

Output: one PNG per page, uploaded to Supabase Storage at:
  pages/{document_id}/p{page_number:04d}.png

Returns: dict mapping page_number (1-indexed) → storage_path
"""

import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import fitz  # pymupdf
import requests

def _supabase_url() -> str:
    return os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")

def _supabase_key() -> str:
    return os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# Render scale — 1.5x gives 918×1188px for a standard A4 page (~150–250 KB/page)
_RENDER_SCALE = 1.5

# Crop margins to remove BIS license watermark (in PDF points, 1pt = 1/72 inch)
# Top:  y < 50  — horizontal "Book Supply Bureau Under the License from BIS..." strip
# Right: x > 554 on a 612-wide page — vertical rotated sidebar watermark
_CROP_TOP    = 50
_CROP_RIGHT_MARGIN = 58  # strip from right edge


def render_pages_local(
    pdf_path: Path,
    out_dir: Path,
    page_range: tuple[int, int] | None = None,
) -> dict[int, Path]:
    """
    Render PDF pages to PNG files in out_dir. No uploads — for local testing.

    page_range: (start, end) 0-indexed inclusive. None = all pages.
    Returns: {page_number_1indexed: local_path}
    """
    pdf = fitz.open(str(pdf_path))
    total = len(pdf)
    start, end = (0, total - 1) if page_range is None else page_range

    out_dir.mkdir(parents=True, exist_ok=True)
    mat = fitz.Matrix(_RENDER_SCALE, _RENDER_SCALE)
    results: dict[int, Path] = {}

    for i in range(start, min(end + 1, total)):
        page = pdf[i]
        clip = fitz.Rect(0, _CROP_TOP, page.rect.width - _CROP_RIGHT_MARGIN, page.rect.height)
        pix = page.get_pixmap(matrix=mat, clip=clip)
        out_path = out_dir / f"p{i + 1:04d}.png"
        pix.save(str(out_path))
        results[i + 1] = out_path

    pdf.close()
    print(f"  Rendered {len(results)} pages → {out_dir}")
    return results


def _upload_page(document_id: str, page_number: int, image_bytes: bytes) -> str:
    """Upload a single page PNG to Supabase Storage. Returns storage path or ''."""
    path = f"pages/{document_id}/p{page_number:04d}.png"
    url = f"{_supabase_url()}/storage/v1/object/regulation-pdfs/{path}"
    for attempt in range(3):
        try:
            resp = requests.put(
                url,
                headers={
                    "Authorization": f"Bearer {_supabase_key()}",
                    "Content-Type": "image/png",
                    "x-upsert": "true",
                },
                data=image_bytes,
                timeout=60,
            )
            if resp.ok:
                return path
            print(
                f"  Warning: page {page_number} upload failed ({resp.status_code}): {resp.text[:100]}",
                file=sys.stderr,
            )
            return ""
        except requests.exceptions.Timeout:
            if attempt < 2:
                print(f"  Timeout on page {page_number}, retrying ({attempt + 2}/3)…", file=sys.stderr)
                continue
            print(f"  Warning: page {page_number} upload timed out after 3 attempts", file=sys.stderr)
            return ""
    return ""


def render_and_upload_pages(
    pdf_path: Path,
    document_id: str,
    conn,
    job_id: str,
    update_job_fn=None,
    page_range: tuple[int, int] | None = None,
) -> dict[int, str]:
    """
    Render all PDF pages and upload to Supabase Storage.
    Inserts rows into document_pages table.

    page_range: (start, end) 0-indexed inclusive. None = all pages.
    Returns: {page_number_1indexed: storage_path}
    """
    _update_job = update_job_fn or (lambda *a, **k: None)

    pdf = fitz.open(str(pdf_path))
    total = len(pdf)
    start, end = (0, total - 1) if page_range is None else page_range
    count = end - start + 1

    print(f"  Rendering {count} pages (scale {_RENDER_SCALE}x)…")
    _update_job(conn, job_id, pages_total=count, pages_done=0)

    mat = fitz.Matrix(_RENDER_SCALE, _RENDER_SCALE)

    # Render all pages to (page_number, image_bytes, width, height) tuples first
    rendered: list[tuple[int, bytes, int, int]] = []
    for i in range(start, min(end + 1, total)):
        page = pdf[i]
        clip = fitz.Rect(0, _CROP_TOP, page.rect.width - _CROP_RIGHT_MARGIN, page.rect.height)
        pix = page.get_pixmap(matrix=mat, clip=clip)
        rendered.append((i + 1, pix.tobytes("png"), pix.width, pix.height))

    pdf.close()

    # Upload pages concurrently (4 workers — balances speed vs Supabase rate limits)
    results: dict[int, str] = {}
    with ThreadPoolExecutor(max_workers=4) as pool_ex:
        future_to_page = {
            pool_ex.submit(_upload_page, document_id, page_number, image_bytes): (page_number, width, height)
            for page_number, image_bytes, width, height in rendered
        }
        for future in as_completed(future_to_page):
            page_number, width, height = future_to_page[future]
            storage_path = future.result()
            if storage_path:
                results[page_number] = (storage_path, width, height)

    # Write DB rows in page order
    with conn.cursor() as cur:
        for page_number in sorted(results):
            storage_path, width, height = results[page_number]
            cur.execute(
                """
                INSERT INTO document_pages (document_id, page_number, image_path, width_px, height_px)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (document_id, page_number) DO UPDATE
                  SET image_path = EXCLUDED.image_path,
                      width_px   = EXCLUDED.width_px,
                      height_px  = EXCLUDED.height_px
                """,
                (document_id, page_number, storage_path, width, height),
            )
        conn.commit()

    page_results = {pn: sp for pn, (sp, _, _) in results.items()}
    _update_job(conn, job_id, pages_done=len(page_results))
    print(f"\n  Done: {len(page_results)} pages uploaded")
    return page_results
