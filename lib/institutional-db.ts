import { neon } from "@neondatabase/serverless";
import { ensureSchema } from "./db-postgres";
import { detectInstitutional } from "./institutional";

/** Institutional filter — database paths (Ethan, Oct 17, 2026).
 * The pure detection core lives in lib/institutional.ts; this module
 * holds the DB-writing paths (batch pass, override, stats, per-row
 * refresh) split out of lib/market-db.ts, which outgrew the GitHub
 * push payload cap. importCompanies / rescore / restore in
 * market-db.ts call into here; the routes call the batch + override. */

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (market intel requires Postgres)");
  return neon(url);
}

const str = (v: unknown): string => String(v ?? "");

/** Institutional-detection refresh for ONE existing row (rescore /
 * restore paths): the refreshRowChain twin. Skips dismissed rows and
 * institutional-exempt rows. Returns true on a write. */
export async function refreshRowInstitutional(r: Record<string, unknown>, details: string): Promise<boolean> {
  if (str(r.status) === "dismissed" || r.institutional_exempt === true) return false;
  const v = detectInstitutional(
    { name: str(r.name), sector: str(r.sector), details }
  );
  const reason = v.isInstitutional ? v.reason : v.suspect ? v.suspectReason : "";
  if (
    v.isInstitutional === (r.is_institutional === true) &&
    v.suspect === (r.institutional_suspect === true) &&
    reason === str(r.institutional_reason)
  ) {
    return false;
  }
  const db = sql();
  await db`
    UPDATE mi_companies
    SET is_institutional = ${v.isInstitutional}, institutional_reason = ${reason}, institutional_suspect = ${v.suspect}, updated_at = NOW()
    WHERE id = ${str(r.id)}`;
  return true;
}

/** Batch institutional-detection pass over existing records (paged
 * like rescoreCompanies; returns nextOffset or -1). Mirrors the chain
 * batch: skips dismissed records entirely and institutional-exempt
 * records (the override is permanent). Only changed rows are written. */
export async function runInstitutionalDetectionBatch(
  offset: number,
  pageSize = 1500
): Promise<{
  processed: number; flagged: number; suspected: number; cleared: number;
  skippedDismissed: number; skippedExempt: number; byCategory: Record<string, number>;
  nextOffset: number;
}> {
  await ensureSchema();
  const db = sql();
  const rows = await db`SELECT * FROM mi_companies ORDER BY id LIMIT ${pageSize} OFFSET ${offset}`;
  let flagged = 0, suspected = 0, cleared = 0, skippedDismissed = 0, skippedExempt = 0;
  const byCategory: Record<string, number> = {};
  const updates: { id: string; isInst: boolean; reason: string; suspect: boolean }[] = [];
  for (const r of rows) {
    const row = r as Record<string, unknown>;
    if (str(row.status) === "dismissed") { skippedDismissed++; continue; }
    if (row.institutional_exempt === true) { skippedExempt++; continue; }
    const v = detectInstitutional(
      { name: str(row.name), sector: str(row.sector), details: str(row.details) }
    );
    const curInst = row.is_institutional === true;
    const curSuspect = row.institutional_suspect === true;
    const curReason = str(row.institutional_reason);
    const nextReason = v.isInstitutional ? v.reason : v.suspect ? v.suspectReason : "";
    if (v.isInstitutional !== curInst || v.suspect !== curSuspect || nextReason !== curReason) {
      updates.push({ id: str(row.id), isInst: v.isInstitutional, reason: nextReason, suspect: v.suspect });
      if (v.isInstitutional && !curInst) {
        flagged++;
        const cat = (v.reason.match(/^Institutional: ([^—]+?) —/)?.[1] ?? "institutional").trim();
        byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      } else if (v.suspect && !curSuspect && !v.isInstitutional) {
        suspected++;
      } else if (!v.isInstitutional && !v.suspect && (curInst || curSuspect)) {
        cleared++;
      }
    }
  }
  const CH = 300;
  for (let i = 0; i < updates.length; i += CH) {
    const chunk = updates.slice(i, i + CH);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((u, j) => {
      const b = j * 4;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`);
      params.push(u.id, u.isInst, u.reason, u.suspect);
    });
    await db.query(
      `UPDATE mi_companies AS c
       SET is_institutional = v.is_inst::boolean, institutional_reason = v.reason, institutional_suspect = v.suspect::boolean, updated_at = NOW()
       FROM (VALUES ${values.join(", ")}) AS v(id, is_inst, reason, suspect)
       WHERE c.id = v.id`,
      params
    );
  }
  return {
    processed: rows.length, flagged, suspected, cleared,
    skippedDismissed, skippedExempt, byCategory,
    nextOffset: rows.length < pageSize ? -1 : offset + rows.length,
  };
}

/** "Not institutional" override (Ethan, Oct 17, 2026): clears the
 * flag/suspect tag and records a PERMANENT exemption — detection
 * skips exempt records in every path, so an overridden company is
 * never re-flagged. Its fit stage and date_added are untouched, so
 * it returns to the Fits section at its original position. */
export async function markNotInstitutional(id: string): Promise<void> {
  await ensureSchema();
  await sql()`
    UPDATE mi_companies
    SET is_institutional = false, institutional_reason = '', institutional_suspect = false,
        institutional_exempt = true, updated_at = NOW()
    WHERE id = ${id}`;
}

/** Institutional stats for verification / the settings surfaces. */
export async function countInstitutionalStats(): Promise<{ institutional: number; suspect: number; exempt: number; instFits: number }> {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    SELECT
      COUNT(*) FILTER (WHERE is_institutional)::int AS inst,
      COUNT(*) FILTER (WHERE institutional_suspect AND NOT is_institutional)::int AS suspect,
      COUNT(*) FILTER (WHERE institutional_exempt)::int AS exempt,
      COUNT(*) FILTER (WHERE (is_institutional OR institutional_suspect) AND status = 'fit')::int AS inst_fits
    FROM mi_companies`;
  const r = (rows as unknown as Record<string, unknown>[])[0] ?? {};
  return {
    institutional: Number(r.inst ?? 0),
    suspect: Number(r.suspect ?? 0),
    exempt: Number(r.exempt ?? 0),
    instFits: Number(r.inst_fits ?? 0),
  };
}

/** Removal-report breakdown (Ethan, Oct 17, 2026): flagged/suspect
 * counts per sector, per reason category, and how many were sitting
 * in the fit stage (i.e. removed from Fits by this filter). */
export async function getInstitutionalBreakdown(): Promise<{
  bySector: { sector: string; flagged: number; suspected: number; fitsRemoved: number }[];
  byReason: { reason: string; n: number }[];
}> {
  await ensureSchema();
  const db = sql();
  const sectorRows = (await db`
    SELECT sector,
      COUNT(*) FILTER (WHERE is_institutional)::int AS flagged,
      COUNT(*) FILTER (WHERE institutional_suspect AND NOT is_institutional)::int AS suspected,
      COUNT(*) FILTER (WHERE (is_institutional OR institutional_suspect) AND status = 'fit')::int AS fits_removed
    FROM mi_companies GROUP BY sector ORDER BY sector`) as unknown as Record<string, unknown>[];
  const reasonRows = (await db`
    SELECT
      CASE
        WHEN is_institutional THEN split_part(institutional_reason, ' — ', 1)
        ELSE 'Possible institution (suspect)'
      END AS reason,
      COUNT(*)::int AS n
    FROM mi_companies
    WHERE is_institutional OR institutional_suspect
    GROUP BY 1 ORDER BY 2 DESC`) as unknown as Record<string, unknown>[];
  return {
    bySector: sectorRows.map((r) => ({
      sector: str(r.sector),
      flagged: Number(r.flagged ?? 0),
      suspected: Number(r.suspected ?? 0),
      fitsRemoved: Number(r.fits_removed ?? 0),
    })),
    byReason: reasonRows.map((r) => ({ reason: str(r.reason), n: Number(r.n ?? 0) })),
  };
}
