import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { isAdminAuthorized, unauthorizedResponse } from "@/lib/adminAuth";

/** GET /api/admin/submissions/[id] — single submission for status polling */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse();

  const { id } = await params;

  try {
    const result = await pool.query(
      `SELECT
        id, municipality_id, municipality_name, province, bylaw_type,
        title, source_url, notes, submitter_name, submitter_email,
        status, review_notes, reviewed_at, ingested_at, created_at
       FROM bylaw_submissions WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    return NextResponse.json({ submission: result.rows[0] });
  } catch (err) {
    console.error("[admin/submissions/[id] GET]", err);
    return NextResponse.json({ error: "Failed to load submission" }, { status: 500 });
  }
}
