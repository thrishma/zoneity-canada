import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { isAdminAuthorized, unauthorizedResponse } from "@/lib/adminAuth";

/** POST /api/admin/submissions/[id]/reject — reject a pending submission */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse();

  const { id } = await params;

  const body = await req.json().catch(() => ({})) as { review_notes?: string };
  const review_notes = typeof body.review_notes === "string" ? body.review_notes.trim() : null;

  try {
    const result = await pool.query(
      `UPDATE bylaw_submissions
       SET status = 'rejected', review_notes = $2, reviewed_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'reviewed')
       RETURNING id, status`,
      [id, review_notes]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Submission not found or already ingested/rejected" },
        { status: 404 }
      );
    }

    console.log(`[admin] Rejected submission ${id}: ${review_notes ?? "(no reason)"}`);
    return NextResponse.json({ success: true, submission: result.rows[0] });
  } catch (err) {
    console.error("[admin/reject]", err);
    return NextResponse.json({ error: "Failed to reject submission" }, { status: 500 });
  }
}
