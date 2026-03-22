#!/usr/bin/env python3
"""
Ontario municipal bylaw parser — converts Docling blocks into structured sections.

Ontario bylaws (Waterloo, Kitchener, Thunder Bay) share a common structure:
  PART X — GENERAL PROVISIONS
    Section X.X  Title
      X.X.X  Subsection
        (a) clause text

This parser normalises that structure into:
  { chapter, chapter_name, section, title, text, page }
"""

import re
import sys
from typing import Optional


# ── Regex patterns for Ontario bylaw structure ────────────────────────────────

# "PART 1 - GENERAL PROVISIONS" or "PART I — ADMINISTRATION"
PART_RE = re.compile(
    r"^PART\s+(\d+|[IVXLC]+)\s*[-—–]\s*(.{3,100})$",
    re.IGNORECASE,
)

# "Section 4.2" or "4.2" or "4.2.3" at the start of a heading block
SECTION_RE = re.compile(
    r"^(?:Section\s+)?(\d+(?:\.\d+){1,3})\s+(.*)",
    re.IGNORECASE | re.DOTALL,
)

# Subsection letter clause: "(a) text" or "a) text"
CLAUSE_RE = re.compile(r"^\(?([a-z](?:\.[ivxlc]+)?)\)\s+(.*)", re.DOTALL)

# Roman numeral parts (I, II, III, IV, V, ...)
_ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6,
          "VII": 7, "VIII": 8, "IX": 9, "X": 10, "XI": 11, "XII": 12,
          "XIII": 13, "XIV": 14, "XV": 15}


def _part_to_int(raw: str) -> int:
    raw = raw.strip().upper()
    if raw.isdigit():
        return int(raw)
    return _ROMAN.get(raw, 0)


def _section_key(section: str) -> tuple[int, ...]:
    """Convert "4.2.3" to (4, 2, 3) for sorting / comparison."""
    try:
        return tuple(int(p) for p in section.split("."))
    except ValueError:
        return (0,)


# ── Parser ────────────────────────────────────────────────────────────────────

def parse_ontario(blocks: list[dict]) -> list[dict]:
    """
    Parse Docling blocks from an Ontario municipal bylaw into structured sections.

    Returns list of dicts:
      { chapter, chapter_name, section, title, text, page }
    """
    sections: list[dict] = []

    current_chapter: Optional[int] = None
    current_chapter_name: Optional[str] = None
    current_section: Optional[str] = None
    current_title: Optional[str] = None
    current_page: Optional[int] = None
    buffer: list[str] = []

    def flush():
        nonlocal current_section, current_title, current_page, buffer
        text = "\n".join(buffer).strip()
        if text and current_section:
            sections.append({
                "chapter": current_chapter,
                "chapter_name": current_chapter_name,
                "section": current_section,
                "title": current_title,
                "text": text,
                "page": current_page,
            })
        buffer = []

    for block in blocks:
        btype = block.get("type", "text")
        text = block.get("text", "").strip()
        page = block.get("page")

        if not text:
            continue

        # ── PART heading ──────────────────────────────────────────────────────
        if btype == "heading":
            part_m = PART_RE.match(text)
            if part_m:
                flush()
                current_chapter = _part_to_int(part_m.group(1))
                current_chapter_name = part_m.group(2).strip()
                current_section = None
                current_title = None
                continue

            # ── Section heading ───────────────────────────────────────────────
            sec_m = SECTION_RE.match(text)
            if sec_m:
                flush()
                current_section = sec_m.group(1)
                current_title = sec_m.group(2).strip() or None
                current_page = page
                continue

        # ── Table ─────────────────────────────────────────────────────────────
        if btype == "table":
            table_data = block.get("table_data", [])
            if table_data:
                rows = []
                for row in table_data:
                    rows.append(" | ".join(str(cell) for cell in row))
                buffer.append("\n".join(rows))
            continue

        # ── Regular text / clause ─────────────────────────────────────────────
        # Check if this starts a new numbered section without a heading block
        sec_m = SECTION_RE.match(text)
        if sec_m and btype != "heading":
            existing_key = _section_key(current_section) if current_section else ()
            new_key = _section_key(sec_m.group(1))
            # Only treat as a new section if deeper or at same level
            if len(new_key) >= 2:
                flush()
                current_section = sec_m.group(1)
                current_title = sec_m.group(2).strip() or None
                current_page = page
                continue

        buffer.append(text)

    flush()

    # Filter out sections with very short text (page headers, titles)
    return [s for s in sections if len(s["text"]) > 40]


def parse_ontario_from_markdown(markdown: str, metadata: dict) -> list[dict]:
    """
    Alternative entry point: parse from a full-document Markdown string.
    Used when Docling returns a single Markdown blob instead of blocks.
    """
    lines = markdown.split("\n")
    blocks = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if line.startswith("#"):
            level = len(line) - len(line.lstrip("#"))
            blocks.append({"type": "heading", "text": stripped.lstrip("# ").strip(), "level": level})
        else:
            blocks.append({"type": "text", "text": stripped})
    return parse_ontario(blocks)


if __name__ == "__main__":
    import json
    data = json.load(sys.stdin)
    results = parse_ontario(data)
    print(f"Parsed {len(results)} sections", file=sys.stderr)
    json.dump(results, sys.stdout, indent=2)
