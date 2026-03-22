#!/usr/bin/env python3
"""
Docling-based PDF extractor — used for text-native PDFs like BDA RMP 2015.

Returns a flat list of content blocks:
  { type: 'heading'|'text'|'table'|'image', page, text, table_data?, image_path?, caption? }
"""

import io
import os
import re
import sys
import tempfile
from pathlib import Path

import requests

# NBC PDFs embed text as /Gxx hex glyph IDs (e.g. /G46/G4F → "FO").
# Decode these back to Unicode so the parser can match PART headers and clause numbers.
# Only needed when OCR is disabled (text-layer path).
_GLYPH_RE = re.compile(r"/G([0-9A-Fa-f]{2})")

def _decode_glyphs(text: str) -> str:
    return _GLYPH_RE.sub(lambda m: chr(int(m.group(1), 16)), text)


SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")


def upload_image(document_id: str, image_bytes: bytes, filename: str) -> str:
    """Upload image to Supabase Storage; returns storage path or '' on failure."""
    path = f"images/{document_id}/{filename}"
    url = f"{SUPABASE_URL}/storage/v1/object/regulation-pdfs/{path}"
    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "image/png",
        },
        data=image_bytes,
        timeout=30,
    )
    if not resp.ok:
        print(f"  Warning: image upload failed ({resp.status_code}), skipping", file=sys.stderr)
        return ""
    return path


CHUNK_SIZE = 50  # pages per Docling call — keeps peak RAM under ~2GB


def _extract_chunk(
    pdf_path: Path,
    document_id: str,
    chunk_index: int,
    page_offset: int,
    pipeline_opts,
    force_ocr: bool,
    img_counter_start: int,
) -> tuple[list[dict], str, int]:
    """Run Docling on a single PDF chunk. Returns (blocks, markdown, img_counter)."""
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.base_models import InputFormat
    from docling_core.types.doc import TextItem, TableItem, PictureItem, SectionHeaderItem, ListItem

    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_opts)}
    )
    result = converter.convert(str(pdf_path))
    doc = result.document

    blocks: list[dict] = []
    img_counter = img_counter_start

    def _clean(t: str) -> str:
        return t if force_ocr else _decode_glyphs(t)

    for item, _level in doc.iterate_items():
        # Page numbers in a chunk are relative — add offset to get absolute page.
        page = None
        if hasattr(item, "prov") and item.prov:
            page = item.prov[0].page_no + page_offset

        if isinstance(item, SectionHeaderItem):
            blocks.append({"type": "heading", "page": page, "text": _clean(item.text)})

        elif isinstance(item, ListItem):
            if item.text.strip():
                blocks.append({"type": "text", "page": page, "text": f"- {_clean(item.text.strip())}"})

        elif isinstance(item, TextItem):
            if item.text.strip():
                blocks.append({"type": "text", "page": page, "text": _clean(item.text.strip())})

        elif isinstance(item, TableItem):
            try:
                df = item.export_to_dataframe()
                headers = list(df.columns)
                rows = [list(row) for row in df.itertuples(index=False, name=None)]
                caption = ""
                if hasattr(item, "captions") and item.captions:
                    caption = (
                        item.captions[0].text
                        if hasattr(item.captions[0], "text")
                        else str(item.captions[0])
                    )
                blocks.append({
                    "type": "table",
                    "page": page,
                    "text": _clean(item.export_to_markdown()),
                    "table_data": {
                        "headers": [_clean(str(h)) for h in headers],
                        "rows": [[_clean(str(c)) for c in row] for row in rows],
                        "caption": _clean(caption),
                    },
                })
            except Exception as e:
                print(f"  Warning: table export failed on page {page}: {e}", file=sys.stderr)

        elif isinstance(item, PictureItem):
            try:
                img_counter += 1
                img_bytes = io.BytesIO()
                img = item.get_image(doc)
                if img:
                    img.save(img_bytes, format="PNG")
                    img_bytes.seek(0)
                    filename = f"p{page or 0}-img{img_counter}.png"
                    storage_path = upload_image(document_id, img_bytes.read(), filename)
                    caption = ""
                    if hasattr(item, "captions") and item.captions:
                        caption = (
                            item.captions[0].text
                            if hasattr(item.captions[0], "text")
                            else ""
                        )
                    if storage_path:
                        blocks.append({
                            "type": "image",
                            "page": page,
                            "text": caption or f"Figure on page {page}",
                            "image_path": storage_path,
                            "caption": caption,
                        })
            except Exception as e:
                print(f"  Warning: image export failed on page {page}: {e}", file=sys.stderr)

    return blocks, doc.export_to_markdown(), img_counter


def extract_with_docling(
    pdf_path: Path,
    document_id: str,
    conn,
    job_id: str,
    update_job_fn=None,
    force_ocr: bool = False,
) -> tuple[list[dict], str]:
    """
    Run Docling on the PDF and return (blocks, full_markdown).

    For large PDFs, splits into CHUNK_SIZE-page chunks processed sequentially
    to keep peak RAM usage bounded.

    force_ocr: ignore the PDF text layer and OCR rendered page images instead.
               Use for PDFs whose text layer has broken character positioning
               (e.g. NBC 2016 which encodes each char at an individual absolute position).

    update_job_fn: optional callable(conn, job_id, **fields) for progress updates.
    """
    import fitz  # pymupdf
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, TesseractCliOcrOptions

    def _noop(*args, **kwargs):
        pass

    _update_job = update_job_fn or _noop

    mode = "force-OCR" if force_ocr else "text-layer"

    pipeline_opts = PdfPipelineOptions()
    pipeline_opts.do_ocr = force_ocr
    pipeline_opts.do_table_structure = True
    pipeline_opts.images_scale = 1.5
    if force_ocr:
        pipeline_opts.ocr_options = TesseractCliOcrOptions(force_full_page_ocr=True)

    # Open once — reused for all chunk splits, closed after the loop.
    src = fitz.open(str(pdf_path))
    total_pages = src.page_count

    n_chunks = (total_pages + CHUNK_SIZE - 1) // CHUNK_SIZE
    print(f"  Initialising Docling ({mode} mode) — {total_pages} pages in {n_chunks} chunks of {CHUNK_SIZE}…")

    _update_job(conn, job_id, pages_done=0)

    all_blocks: list[dict] = []
    all_markdown_parts: list[str] = []
    img_counter = 0

    with tempfile.TemporaryDirectory() as chunk_dir:
        chunk_dir_path = Path(chunk_dir)
        for chunk_idx in range(n_chunks):
            start_page = chunk_idx * CHUNK_SIZE
            end_page = min(start_page + CHUNK_SIZE, total_pages)  # exclusive

            # Write chunk PDF.
            chunk_path = chunk_dir_path / f"chunk_{chunk_idx:04d}.pdf"
            chunk_doc = fitz.open()
            chunk_doc.insert_pdf(src, from_page=start_page, to_page=end_page - 1)
            chunk_doc.save(str(chunk_path))
            chunk_doc.close()

            print(f"  Chunk {chunk_idx + 1}/{n_chunks}: pages {start_page + 1}–{end_page}")
            blocks, markdown, img_counter = _extract_chunk(
                chunk_path,
                document_id,
                chunk_idx,
                page_offset=start_page,
                pipeline_opts=pipeline_opts,
                force_ocr=force_ocr,
                img_counter_start=img_counter,
            )
            all_blocks.extend(blocks)
            all_markdown_parts.append(markdown)
            chunk_path.unlink()  # free disk space immediately
            _update_job(conn, job_id, pages_done=end_page)

    src.close()
    full_markdown = "\n\n".join(all_markdown_parts)
    print(f"  Docling extracted {len(all_blocks)} blocks ({img_counter} images) across {n_chunks} chunks")
    return all_blocks, full_markdown
