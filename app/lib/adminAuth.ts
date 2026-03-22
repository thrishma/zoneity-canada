import type { NextRequest } from "next/server";

/**
 * Returns true if the request carries a valid admin secret.
 * Checks (in order):
 *   1. Authorization: Bearer <secret> header
 *   2. x-admin-secret header
 *   3. admin_secret cookie (for browser-based admin UI)
 */
export function isAdminAuthorized(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    console.error("[admin] ADMIN_SECRET env var is not set");
    return false;
  }

  // Bearer token
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7) === secret;
  }

  // Explicit header
  const headerSecret = req.headers.get("x-admin-secret");
  if (headerSecret) return headerSecret === secret;

  // Cookie (browser sessions)
  const cookie = req.cookies.get("admin_secret");
  if (cookie) return cookie.value === secret;

  return false;
}

export function unauthorizedResponse() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
