import { Pool, type QueryResultRow } from "pg";

const pool = new Pool({
  connectionString:
    process.env.SUPABASE_POSTGRES_TRANSACTION_POOLER ??
    process.env.SUPABASE_POSTGRES_URL ??
    process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  options: "-c statement_timeout=8000",
});

pool.on("error", (err) => {
  console.error("[DB] Unexpected pool error", err);
});

export async function queryOneOrNull<T extends QueryResultRow>(
  sql: string,
  params: unknown[],
  warnContext: Record<string, unknown>
): Promise<T | null> {
  const result = await pool.query<T>(sql, params);
  if (!result.rows[0]) {
    console.warn("[DB] Row not found", warnContext);
    return null;
  }
  return result.rows[0];
}

export default pool;
