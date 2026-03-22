import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

const BYLAW_TYPES = [
  "zoning_bylaw",
  "official_plan",
  "parking_bylaw",
  "site_plan_bylaw",
  "other",
] as const;

/** GET /api/bylaws/submit — recent accepted submissions (for public feed) */
export async function GET() {
  try {
    const result = await pool.query(`
      SELECT
        id,
        municipality_name,
        province,
        bylaw_type,
        title,
        source_url,
        status,
        created_at
      FROM bylaw_submissions
      WHERE status IN ('reviewed', 'ingesting', 'ingested')
      ORDER BY created_at DESC
      LIMIT 20
    `);
    return NextResponse.json({ submissions: result.rows });
  } catch (err) {
    console.error("[submit GET]", err);
    return NextResponse.json({ error: "Failed to load submissions" }, { status: 500 });
  }
}

/** POST /api/bylaws/submit — community bylaw contribution */
export async function POST(req: NextRequest) {
  // Rate limit: 3 submissions per IP per hour
  const ip = getClientIp(req);
  if (!checkRateLimit(`submit:${ip}`, 3, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: "Too many submissions. Please try again in an hour." },
      { status: 429 }
    );
  }

  try {
    const body: unknown = await req.json();
    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const {
      municipality_id,
      municipality_name,
      province,
      bylaw_type,
      title,
      source_url,
      notes,
      submitter_name,
      submitter_email,
    } = body as Record<string, unknown>;

    // Validate required fields
    const errors: string[] = [];
    if (!municipality_name || typeof municipality_name !== "string" || !municipality_name.trim())
      errors.push("municipality_name is required");
    if (!province || typeof province !== "string" || !province.trim())
      errors.push("province is required");
    if (!bylaw_type || !BYLAW_TYPES.includes(bylaw_type as typeof BYLAW_TYPES[number]))
      errors.push(`bylaw_type must be one of: ${BYLAW_TYPES.join(", ")}`);
    if (!title || typeof title !== "string" || !title.trim())
      errors.push("title is required");
    if (!source_url || typeof source_url !== "string" || !source_url.trim())
      errors.push("source_url is required");

    // Basic URL validation
    if (source_url && typeof source_url === "string") {
      try {
        const parsed = new URL(source_url);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          errors.push("source_url must be an http or https URL");
        }
      } catch {
        errors.push("source_url is not a valid URL");
      }
    }

    if (submitter_email && typeof submitter_email === "string" && submitter_email.trim()) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submitter_email)) {
        errors.push("submitter_email is not a valid email address");
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
    }

    // Verify municipality_id exists if provided
    let resolvedMunicipalityId: string | null = null;
    if (municipality_id && typeof municipality_id === "string" && municipality_id.trim()) {
      const check = await pool.query(
        "SELECT id FROM municipalities WHERE id = $1",
        [municipality_id.trim()]
      );
      resolvedMunicipalityId = check.rows.length > 0 ? municipality_id.trim() : null;
    }

    const result = await pool.query(
      `INSERT INTO bylaw_submissions
         (municipality_id, municipality_name, province, bylaw_type, title,
          source_url, notes, submitter_name, submitter_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, created_at`,
      [
        resolvedMunicipalityId,
        (municipality_name as string).trim(),
        (province as string).trim().toUpperCase(),
        bylaw_type,
        (title as string).trim(),
        (source_url as string).trim(),
        notes && typeof notes === "string" ? notes.trim() || null : null,
        submitter_name && typeof submitter_name === "string" ? submitter_name.trim() || null : null,
        submitter_email && typeof submitter_email === "string" ? submitter_email.trim() || null : null,
      ]
    );

    return NextResponse.json(
      {
        success: true,
        id: result.rows[0].id,
        message: "Thank you for your submission. Our team will review and ingest it shortly.",
      },
      { status: 201 }
    );
  } catch (err) {
    // Unique constraint on source_url — duplicate submission
    if (
      err instanceof Error &&
      err.message.includes("unique_submission_source_url")
    ) {
      return NextResponse.json(
        { error: "This URL has already been submitted. Thank you!" },
        { status: 409 }
      );
    }
    console.error("[submit POST]", err);
    return NextResponse.json({ error: "Submission failed. Please try again." }, { status: 500 });
  }
}
