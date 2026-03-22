import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import pool from "@/lib/db";
import { withCache } from "@/lib/cache";
import type { BylawSearchResult } from "@/types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_LIMIT = 8;
const SIMILARITY_THRESHOLD = 0.3;

async function embedQuery(text: string): Promise<number[]> {
  const resp = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.trim(),
  });
  return resp.data[0].embedding;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const municipalityId = searchParams.get("municipality") ?? null;
  const bylawType = searchParams.get("type") ?? null;
  const limit = Math.min(Number(searchParams.get("limit") ?? DEFAULT_LIMIT), 20);

  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  try {
    const embedding = await withCache(
      `embed:${q}`,
      10 * 60 * 1000, // 10 min
      () => embedQuery(q)
    );

    const vectorLiteral = `[${embedding.join(",")}]`;

    const conditions: string[] = [`1 - (s.embedding <=> $1::vector) > ${SIMILARITY_THRESHOLD}`];
    const params: unknown[] = [vectorLiteral];
    let paramIndex = 2;

    if (municipalityId) {
      conditions.push(`s.municipality_id = $${paramIndex++}`);
      params.push(municipalityId);
    }
    if (bylawType) {
      conditions.push(`d.bylaw_type = $${paramIndex++}`);
      params.push(bylawType);
    }

    params.push(limit);

    const sql = `
      SELECT
        s.id,
        s.document_id,
        s.municipality_id,
        m.name   AS municipality_name,
        m.province,
        d.bylaw_type,
        s.section,
        s.title,
        s.text,
        s.page,
        1 - (s.embedding <=> $1::vector) AS similarity
      FROM bylaw_sections s
      JOIN bylaw_documents d ON d.id = s.document_id
      JOIN municipalities m ON m.id = s.municipality_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY s.embedding <=> $1::vector
      LIMIT $${paramIndex}
    `;

    const result = await pool.query<BylawSearchResult>(sql, params);
    return NextResponse.json({ results: result.rows });
  } catch (err) {
    console.error("[bylaws/search]", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
