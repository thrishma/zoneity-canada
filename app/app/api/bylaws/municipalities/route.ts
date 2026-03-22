import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { withCache } from "@/lib/cache";
import type { Municipality } from "@/types";

const TTL = 5 * 60 * 1000; // 5 min

export async function GET() {
  try {
    const rows = await withCache("municipalities:all", TTL, async () => {
      const result = await pool.query<Municipality>(`
        SELECT
          m.id,
          m.name,
          m.province,
          m.population,
          m.website,
          COUNT(d.id)::int AS document_count
        FROM municipalities m
        LEFT JOIN bylaw_documents d ON d.municipality_id = m.id
        GROUP BY m.id
        ORDER BY m.province, m.name
      `);
      return result.rows;
    });
    return NextResponse.json({ municipalities: rows });
  } catch (err) {
    console.error("[municipalities]", err);
    return NextResponse.json({ error: "Failed to load municipalities" }, { status: 500 });
  }
}
