import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

/**
 * GET /api/bylaws/quality
 *
 * Returns data quality summary: coverage gaps, None metrics,
 * and document ingest status per municipality.
 * Useful for QA dashboards and identifying where human review is needed.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const municipalityId = searchParams.get("municipality") ?? null;

  try {
    const whereClause = municipalityId ? "WHERE m.id = $1" : "";
    const params = municipalityId ? [municipalityId] : [];

    // Coverage: which metrics are missing per municipality
    const coverageResult = await pool.query(
      `WITH metric_keys AS (
         SELECT unnest(ARRAY[
           'min_lot_size_sqm',
           'max_height_residential_m',
           'min_parking_per_unit',
           'permits_secondary_suite',
           'permits_multiplex',
           'max_density_units_per_ha'
         ]) AS metric_key
       ),
       municipality_metrics AS (
         SELECT
           m.id AS municipality_id,
           m.name AS municipality_name,
           m.province,
           mk.metric_key,
           bm.value
         FROM municipalities m
         CROSS JOIN metric_keys mk
         LEFT JOIN bylaw_metrics bm
           ON bm.municipality_id = m.id AND bm.metric_key = mk.metric_key
         ${whereClause}
       )
       SELECT
         municipality_id,
         municipality_name,
         province,
         COUNT(*) AS total_metrics,
         COUNT(value) AS populated_metrics,
         COUNT(*) - COUNT(value) AS missing_metrics,
         ROUND(COUNT(value)::numeric / COUNT(*) * 100, 1) AS coverage_pct,
         jsonb_object_agg(metric_key, COALESCE(value, 'MISSING')) AS metric_values
       FROM municipality_metrics
       GROUP BY municipality_id, municipality_name, province
       ORDER BY province, municipality_name`,
      params
    );

    // Document ingest status
    const docsResult = await pool.query(
      `SELECT
         m.id AS municipality_id,
         m.name AS municipality_name,
         d.bylaw_type,
         d.title,
         COUNT(s.id)::int AS section_count,
         d.ingested_at,
         d.version_hash IS NOT NULL AS has_hash
       FROM municipalities m
       JOIN bylaw_documents d ON d.municipality_id = m.id
       LEFT JOIN bylaw_sections s ON s.document_id = d.id
       ${whereClause}
       GROUP BY m.id, m.name, d.id, d.bylaw_type, d.title, d.ingested_at, d.version_hash
       ORDER BY m.name, d.bylaw_type`,
      params
    );

    return NextResponse.json({
      coverage: coverageResult.rows,
      documents: docsResult.rows,
      summary: {
        total_municipalities: coverageResult.rows.length,
        fully_covered: coverageResult.rows.filter((r) => r.missing_metrics === "0").length,
        needs_review: coverageResult.rows.filter((r) => Number(r.missing_metrics) > 3).length,
      },
    });
  } catch (err) {
    console.error("[bylaws/quality]", err);
    return NextResponse.json({ error: "Quality check failed" }, { status: 500 });
  }
}
