import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { isAdminAuthorized, unauthorizedResponse } from "@/lib/adminAuth";

/** POST /api/admin/submissions/[id]/approve — mark submission as reviewed */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse();

  const { id } = await params;

  try {
    const result = await pool.query(
      `UPDATE bylaw_submissions
       SET status = 'reviewed', reviewed_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING id, status`,
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Submission not found or not in pending status" },
        { status: 404 }
      );
    }

    console.log(`[admin] Approved submission ${id}`);
    return NextResponse.json({ success: true, submission: result.rows[0] });
  } catch (err) {
    console.error("[admin/approve]", err);
    return NextResponse.json({ error: "Failed to approve submission" }, { status: 500 });
  }
}
