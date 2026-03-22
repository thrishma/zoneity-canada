import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { isAdminAuthorized, unauthorizedResponse } from "@/lib/adminAuth";

/**
 * GET /api/admin/submissions
 * Returns all submissions, newest first.
 * Query params:
 *   ?status=pending|reviewed|ingesting|ingested|rejected  (default: all)
 *   ?limit=50 (default 50, max 200)
 */
export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);

  const VALID_STATUSES = ["pending", "reviewed", "ingesting", "ingested", "rejected"];
  const useStatusFilter = status && VALID_STATUSES.includes(status);

  try {
    const result = await pool.query(
      `SELECT
        id,
        municipality_id,
        municipality_name,
        province,
        bylaw_type,
        title,
        source_url,
        notes,
        submitter_name,
        submitter_email,
        status,
        review_notes,
        reviewed_at,
        ingested_at,
        created_at
      FROM bylaw_submissions
      ${useStatusFilter ? "WHERE status = $1" : ""}
      ORDER BY
        CASE status
          WHEN 'pending'   THEN 1
          WHEN 'reviewed'  THEN 2
          WHEN 'ingesting' THEN 3
          WHEN 'ingested'  THEN 4
          WHEN 'rejected'  THEN 5
        END,
        created_at DESC
      LIMIT ${useStatusFilter ? "$2" : "$1"}`,
      useStatusFilter ? [status, limit] : [limit]
    );

    return NextResponse.json({ submissions: result.rows, total: result.rowCount });
  } catch (err) {
    console.error("[admin/submissions GET]", err);
    return NextResponse.json({ error: "Failed to load submissions" }, { status: 500 });
  }
}
