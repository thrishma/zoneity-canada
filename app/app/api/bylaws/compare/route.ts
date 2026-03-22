import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import type { ComparisonMetric } from "@/types";

// Hard-coded comparison metrics pulled from structured fields in bylaw_metrics table
const METRIC_QUERIES: Array<{ key: string; label: string; description: string }> = [
  {
    key: "min_lot_size_sqm",
    label: "Minimum Lot Size (Residential)",
    description: "Smallest permitted residential lot in the base R-1/low-density zone",
  },
  {
    key: "max_height_residential_m",
    label: "Max Building Height — Residential",
    description: "Maximum permitted building height in residential zones",
  },
  {
    key: "min_parking_per_unit",
    label: "Min Parking (per dwelling unit)",
    description: "Required parking spaces per unit in multi-residential buildings",
  },
  {
    key: "permits_secondary_suite",
    label: "Secondary Suites Permitted",
    description: "Whether secondary suites (in-law suites) are permitted as-of-right",
  },
  {
    key: "permits_multiplex",
    label: "Multiplex (4+ units) Permitted",
    description: "Whether 4+ unit residential buildings are permitted in residential zones",
  },
  {
    key: "max_density_units_per_ha",
    label: "Max Density (units/ha)",
    description: "Maximum residential density in medium-density zones",
  },
];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ids = searchParams.getAll("id");

  if (ids.length < 2) {
    return NextResponse.json(
      { error: "Provide at least 2 municipality ids via ?id=...&id=..." },
      { status: 400 }
    );
  }

  try {
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
    const result = await pool.query<{
      municipality_id: string;
      metric_key: string;
      value: string | null;
    }>(
      `SELECT municipality_id, metric_key, value
       FROM bylaw_metrics
       WHERE municipality_id IN (${placeholders})
         AND metric_key IN (${METRIC_QUERIES.map((_, i) => `$${ids.length + i + 1}`).join(", ")})`,
      [...ids, ...METRIC_QUERIES.map((m) => m.key)]
    );

    // Build lookup: municipality_id -> metric_key -> value
    const lookup: Record<string, Record<string, string | null>> = {};
    for (const row of result.rows) {
      lookup[row.municipality_id] ??= {};
      lookup[row.municipality_id][row.metric_key] = row.value;
    }

    const metrics: ComparisonMetric[] = METRIC_QUERIES.map((m) => ({
      label: m.label,
      description: m.description,
      values: Object.fromEntries(
        ids.map((id) => [id, lookup[id]?.[m.key] ?? null])
      ),
    }));

    return NextResponse.json({ metrics });
  } catch (err) {
    console.error("[compare]", err);
    return NextResponse.json({ error: "Comparison failed" }, { status: 500 });
  }
}
