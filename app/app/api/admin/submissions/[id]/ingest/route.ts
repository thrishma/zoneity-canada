import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import path from "path";
import pool from "@/lib/db";
import { isAdminAuthorized, unauthorizedResponse } from "@/lib/adminAuth";

/**
 * POST /api/admin/submissions/[id]/ingest
 *
 * Triggers ingestion of a reviewed submission:
 *   1. Sets status = 'ingesting'
 *   2. Spawns `python3 scripts/ingest.py --submission-id <id>` as a background process
 *   3. Returns 202 immediately — admin UI polls GET /api/admin/submissions/[id] for completion
 *
 * ingest.py is responsible for:
 *   - Creating the bylaw_documents row
 *   - Running the full extraction / embedding pipeline
 *   - Setting status = 'ingested' on completion (or logging failure)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse();

  const { id } = await params;

  // Validate UUID format to prevent command injection
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return NextResponse.json({ error: "Invalid submission ID" }, { status: 400 });
  }

  try {
    // Only ingest if currently reviewed (not already ingesting/ingested)
    const check = await pool.query(
      "SELECT id, status FROM bylaw_submissions WHERE id = $1",
      [id]
    );

    if (check.rows.length === 0) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    const { status } = check.rows[0] as { status: string };
    if (status === "ingesting") {
      return NextResponse.json({ message: "Already ingesting", status }, { status: 202 });
    }
    if (status === "ingested") {
      return NextResponse.json({ message: "Already ingested", status }, { status: 200 });
    }
    if (status !== "reviewed") {
      return NextResponse.json(
        { error: `Submission must be in 'reviewed' status before ingesting (current: ${status})` },
        { status: 409 }
      );
    }

    // Mark as ingesting before spawning subprocess
    await pool.query(
      "UPDATE bylaw_submissions SET status = 'ingesting' WHERE id = $1",
      [id]
    );

    // Resolve path relative to project root (Next.js runs from app/)
    const scriptPath = path.resolve(process.cwd(), "../scripts/ingest.py");

    // Spawn background subprocess — do not await
    const child = exec(
      `python3 "${scriptPath}" --submission-id "${id}"`,
      { env: { ...process.env } }
    );

    child.stdout?.on("data", (d: string) =>
      console.log(`[ingest:${id}]`, d.trim())
    );
    child.stderr?.on("data", (d: string) =>
      console.error(`[ingest:${id}] ERR`, d.trim())
    );
    child.on("exit", (code) => {
      if (code !== 0) {
        console.error(`[ingest:${id}] Process exited with code ${code}`);
        // Reset status to reviewed so admin can retry
        pool.query(
          "UPDATE bylaw_submissions SET status = 'reviewed' WHERE id = $1 AND status = 'ingesting'",
          [id]
        ).catch((e) => console.error("[ingest:reset]", e));
      } else {
        console.log(`[ingest:${id}] Completed successfully`);
      }
    });

    console.log(`[admin] Spawned ingest subprocess for submission ${id} (pid: ${child.pid})`);

    return NextResponse.json(
      { message: "Ingestion started", status: "ingesting" },
      { status: 202 }
    );
  } catch (err) {
    console.error("[admin/ingest]", err);
    // Reset status on unexpected error
    await pool
      .query(
        "UPDATE bylaw_submissions SET status = 'reviewed' WHERE id = $1 AND status = 'ingesting'",
        [id]
      )
      .catch(() => {});
    return NextResponse.json({ error: "Failed to start ingestion" }, { status: 500 });
  }
}
