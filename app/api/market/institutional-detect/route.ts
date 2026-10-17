import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { logSync } from "@/lib/market-db";
import {
  runInstitutionalDetectionBatch,
  countInstitutionalStats,
  getInstitutionalBreakdown,
} from "@/lib/institutional-db";
import { ensureSchema } from "@/lib/db-postgres";

/**
 * Institutional detection pass over EXISTING company records
 * (Ethan, Oct 17, 2026 — the institutional twin of chain-detect).
 * POST { offset } processes batches from that offset until the table
 * is done or the time budget runs out, and returns progress
 * ({ nextOffset: -1 } when complete) so callers can loop. Dismissed
 * records are skipped (detection never writes them) and "Not
 * institutional" exemptions are permanent. On completion the run
 * logs an institutional-detect entry plus an institutional-detect-
 * xcheck recount from the table itself, and returns the removal
 * breakdown (per sector, per reason category, fits removed).
 * Auth: session cookie OR Bearer CRON_SECRET (see chain-detect).
 */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const authed =
    !!getSessionUser() ||
    (() => {
      const secret = process.env.CRON_SECRET;
      return !secret || req.headers.get("authorization") === `Bearer ${secret}`;
    })();
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { offset?: unknown };
  const startOffset = Math.max(0, Math.floor(Number(body.offset ?? 0)) || 0);
  const startedAt = Date.now();
  try {
    await ensureSchema();
    let offset = startOffset;
    let processed = 0, flagged = 0, suspected = 0, cleared = 0;
    let skippedDismissed = 0, skippedExempt = 0;
    const byCategory: Record<string, number> = {};
    let nextOffset = -1;
    // ~48s budget per call: batches are 1,500 rows; a first pass over
    // the full table may need several calls — the caller loops on
    // nextOffset until it comes back -1.
    while (Date.now() - startedAt < 48_000) {
      const r = await runInstitutionalDetectionBatch(offset, 1500);
      processed += r.processed;
      flagged += r.flagged;
      suspected += r.suspected;
      cleared += r.cleared;
      skippedDismissed += r.skippedDismissed;
      skippedExempt += r.skippedExempt;
      for (const [k, v] of Object.entries(r.byCategory)) byCategory[k] = (byCategory[k] ?? 0) + v;
      nextOffset = r.nextOffset;
      if (nextOffset === -1) break;
      offset = nextOffset;
    }
    const complete = nextOffset === -1;
    let breakdown: Awaited<ReturnType<typeof getInstitutionalBreakdown>> | null = null;
    if (complete) {
      const stats = await countInstitutionalStats();
      breakdown = await getInstitutionalBreakdown();
      const reasonDb = breakdown.byReason.map((r) => `${r.reason}=${r.n}`).join(", ");
      const fitsRemoved = breakdown.bySector.reduce((a, s) => a + s.fitsRemoved, 0);
      await logSync(
        "institutional-detect",
        "ok",
        flagged,
        `Institutional detection pass complete from offset ${startOffset}: ${processed} records judged — ${flagged} newly flagged institutional, ${suspected} newly tagged "Possible institution", ${cleared} cleared; ${skippedDismissed} dismissed skipped, ${skippedExempt} exempt skipped. New flags by category: ${Object.entries(byCategory).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}.`
      );
      await logSync(
        "institutional-detect-xcheck",
        "ok",
        stats.institutional,
        `Recount from mi_companies: ${stats.institutional} institutional-flagged (${reasonDb || "none"}), ${stats.suspect} "Possible institution" suspects, ${stats.exempt} exempt overrides, ${stats.instFits} flagged/suspect rows in the fit stage (excluded from the fits feed + counts by the institutional filter); fits removed per sector: ${breakdown.bySector.map((s) => `${s.sector}=${s.fitsRemoved}`).join(", ")} (total ${fitsRemoved}).`
      );
    }
    return NextResponse.json({
      ok: true,
      complete,
      nextOffset,
      processed,
      flagged,
      suspected,
      cleared,
      skippedDismissed,
      skippedExempt,
      byCategory,
      breakdown,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
