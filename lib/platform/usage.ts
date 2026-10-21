import { sql } from "./db";

/**
 * Lightweight usage log for heavy endpoints (PROJECT_RULES.md): query
 * name, rows returned, approx bytes. Fire-and-forget — a logging failure
 * must never fail the request that produced the numbers.
 */
export function logUsage(queryName: string, rows: number, approxBytes: number): void {
  try {
    const db = sql();
    void db`
      INSERT INTO core.usage_log (query_name, rows_returned, approx_bytes)
      VALUES (${queryName}, ${rows}, ${approxBytes})
    `.catch(() => {
      /* swallow: usage logging is best-effort */
    });
  } catch {
    /* swallow: DATABASE_URL unset / schema not ready yet */
  }
}
