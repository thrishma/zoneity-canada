import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

/**
 * GET /api/bylaws/export
 *
 * Bulk export of all structured bylaw metrics as JSON or CSV.
 * Supports open-data use cases for researchers, journalists, and developers.
 *
 * Query params:
 *   format=json|csv        (default: json)
 *   province=ON            (optional filter)
 *   municipality=waterloo-on  (optional filter)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format") ?? "json";
  const province = searchParams.get("province") ?? null;
  const municipalityId = searchParams.get("municipality") ?? null;

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (province) {
      conditions.push(`m.province = $${i++}`);
      params.push(province.toUpperCase());
    }
    if (municipalityId) {
      conditions.push(`m.id = $${i++}`);
      params.push(municipalityId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Export metrics (one row per municipality × metric_key)
    const metricsResult = await pool.query(
      `SELECT
         m.id            AS municipality_id,
         m.name          AS municipality_name,
         m.province,
         m.population,
         bm.metric_key,
         bm.value,
         bm.updated_at
       FROM municipalities m
       LEFT JOIN bylaw_metrics bm ON bm.municipality_id = m.id
       ${where}
       ORDER BY m.province, m.name, bm.metric_key`,
      params
    );

    // Export sections count per document
    const docsResult = await pool.query(
      `SELECT
         m.id            AS municipality_id,
         m.name          AS municipality_name,
         m.province,
         d.bylaw_type,
         d.title,
         d.source_url,
         d.ingested_at,
         COUNT(s.id)::int AS section_count
       FROM municipalities m
       JOIN bylaw_documents d ON d.municipality_id = m.id
       LEFT JOIN bylaw_sections s ON s.document_id = d.id
       ${where.replace(/m\.province/g, "m.province")}
       GROUP BY m.id, m.name, m.province, d.id, d.bylaw_type, d.title, d.source_url, d.ingested_at
       ORDER BY m.province, m.name, d.bylaw_type`,
      params
    );

    if (format === "csv") {
      // Pivot metrics into wide format (one row per municipality)
      const mMap: Record<string, Record<string, string | null>> = {};
      const keys = new Set<string>();
      for (const row of metricsResult.rows) {
        if (!mMap[row.municipality_id]) {
          mMap[row.municipality_id] = {
            municipality_id: row.municipality_id,
            municipality_name: row.municipality_name,
            province: row.province,
            population: String(row.population ?? ""),
          };
        }
        if (row.metric_key) {
          mMap[row.municipality_id][row.metric_key] = row.value;
          keys.add(row.metric_key);
        }
      }

      const metricCols = Array.from(keys).sort();
      const header = ["municipality_id", "municipality_name", "province", "population", ...metricCols];
      const csvRows = [header.join(",")];
      for (const row of Object.values(mMap)) {
        csvRows.push(header.map((h) => JSON.stringify(row[h] ?? "")).join(","));
      }

      return new NextResponse(csvRows.join("\n"), {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": 'attachment; filename="zoneity-canada-metrics.csv"',
          "Access-Control-Allow-Origin": "*",
          "X-Data-License": "CC-BY-4.0",
        },
      });
    }

    // JSON format
    return NextResponse.json({
      meta: {
        generated_at: new Date().toISOString(),
        license: "CC-BY-4.0",
        source: "Zoneity Canada — https://zoneitycanada.ca",
        description: "Structured zoning metrics and document index extracted from official municipal bylaws",
      },
      municipalities: docsResult.rows,
      metrics: metricsResult.rows,
    });
  } catch (err) {
    console.error("[bylaws/export]", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
