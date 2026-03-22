// ── Municipality ──────────────────────────────────────────────────────────────

export interface Municipality {
  id: string;
  name: string;
  province: string;
  population?: number;
  website?: string;
}

// ── Bylaw document ────────────────────────────────────────────────────────────

export type BylawType =
  | "zoning_bylaw"
  | "official_plan"
  | "parking_bylaw"
  | "site_plan_bylaw"
  | "other";

export interface BylawDocument {
  id: string;
  municipality_id: string;
  municipality_name: string;
  province: string;
  bylaw_type: BylawType;
  title: string;
  source_url: string;
  ingested_at: string;
  version_hash: string;
}

// ── Bylaw section (browse tree node) ─────────────────────────────────────────

export interface BylawSection {
  id: string;
  document_id: string;
  municipality_id: string;
  municipality_name: string;
  bylaw_type: BylawType;
  chapter: number | null;
  chapter_name: string | null;
  section: string;
  title: string | null;
  page: number | null;
  child_count: number;
}

// ── Search result ─────────────────────────────────────────────────────────────

export interface BylawSearchResult {
  id: string;
  document_id: string;
  municipality_id: string;
  municipality_name: string;
  province: string;
  bylaw_type: BylawType;
  section: string;
  title: string | null;
  text: string;
  page: number | null;
  similarity: number;
}

// ── Comparison ────────────────────────────────────────────────────────────────

export interface ComparisonMetric {
  metric_key: string;
  label: string;
  description: string;
  values: Record<string, string | null>; // municipality_id → value
}

// ── Chat ──────────────────────────────────────────────────────────────────────

export interface ChatPayload {
  question: string;
  municipalityId?: string;
  municipalityName?: string;
}

export interface ChatResponse {
  answer: string;
  sources: Array<{
    section: string;
    municipality: string;
    snippet: string;
  }>;
}
