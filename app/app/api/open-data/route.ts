import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import type { OpenDataFeature, OpenDataQueryResult } from "@/types";

const VALID_DATASETS = [
  "building_permits",
  "planning_communities",
  "neighbourhood_assoc",
  "landmarks",
  "address_proximity",
] as const;

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const dataset = searchParams.get("dataset");
  const municipality = searchParams.get("municipality");
  const aggregate = searchParams.get("aggregate"); // property key to count-by
  const limit = Math.min(Number(searchParams.get("limit") ?? DEFAULT_LIMIT), MAX_LIMIT);
  const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0);

  // Collect property filters: filter[KEY]=VALUE
  const propertyFilters: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    if (key.startsWith("filter[") && key.endsWith("]")) {
      const propKey = key.slice(7, -1);
      propertyFilters[propKey] = value;
    }
  }

  if (!dataset) {
    return NextResponse.json({ error: "dataset is required" }, { status: 400 });
  }
  if (!VALID_DATASETS.includes(dataset as (typeof VALID_DATASETS)[number])) {
    return NextResponse.json(
      { error: `dataset must be one of: ${VALID_DATASETS.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const conditions: string[] = ["dataset_name = $1"];
    const params: unknown[] = [dataset];
    let idx = 2;

    if (municipality) {
      conditions.push(`municipality = $${idx++}`);
      params.push(municipality);
    }

    // Property filters: properties->>'KEY' = 'VALUE'
    for (const [key, value] of Object.entries(propertyFilters)) {
      // Sanitize key — allow only alphanumeric + underscore
      if (!/^[A-Za-z0-9_]+$/.test(key)) continue;
      conditions.push(`properties->>'${key}' = $${idx++}`);
      params.push(value);
    }

    const where = conditions.join(" AND ");

    if (aggregate) {
      // Sanitize aggregate key
      if (!/^[A-Za-z0-9_]+$/.test(aggregate)) {
        return NextResponse.json({ error: "Invalid aggregate key" }, { status: 400 });
      }
      const aggSql = `
        SELECT
          properties->>'${aggregate}' AS value,
          COUNT(*)::int AS count
        FROM open_data_features
        WHERE ${where}
          AND properties->>'${aggregate}' IS NOT NULL
        GROUP BY properties->>'${aggregate}'
        ORDER BY count DESC
        LIMIT 100
      `;
      const result = await pool.query<{ value: string; count: number }>(aggSql, params);
      return NextResponse.json({ dataset, aggregate, buckets: result.rows });
    }

    // Count total matching rows (for pagination)
    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM open_data_features WHERE ${where}`,
      params
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    // Fetch page
    const featuresResult = await pool.query<OpenDataFeature>(
      `SELECT id, dataset_name, dataset_label, municipality, feature_id, properties, geometry, ingested_at
       FROM open_data_features
       WHERE ${where}
       ORDER BY ingested_at
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    const response: OpenDataQueryResult = {
      dataset,
      total,
      limit,
      offset,
      features: featuresResult.rows,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[open-data]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
