import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  buildChainNameCounts,
  runChainDetectionBatch,
  countChainStats,
  logSync,
} from "@/lib/market-db";
import { ensureSchema } from "@/lib/db-postgres";
import { neon } from "@neondatabase/serverless";

/**
 * Chain/franchise detection pass over EXISTING company records
 * (Ethan, Oct 16, 2026). POST { offset } processes batches from that
 * offset until the table is done or the time budget runs out, and
 * returns progress ({ nextOffset: -1 } when complete) so callers —
 * the Settings card's re-run button, or an operator with curl — can
 * loop. The same-name location counts (the locations rule's
 * multi-state / anywhere arms) are built once per call. Dismissed
 * records are skipped (detection never writes them) and "Not a
 * chain" exemptions are permanent. On completion the run logs a
 * chain-detect entry plus a chain-detect-xcheck recount from the
 * table itself. Auth: session cookie OR Bearer CRON_SECRET.
 */
export const maxDuration = 60;

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

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
    const counts = await buildChainNameCounts();
    let offset = startOffset;
    let processed = 0, flagged = 0, suspected = 0, cleared = 0;
    let skippedDismissed = 0, skippedExempt = 0;
    const byRule: Record<string, number> = {};
    let nextOffset = -1;
    // ~48s budget per call: batches are 1,500 rows; a first pass over
    // the full table may need several calls — the caller loops on
    // nextOffset until it comes back -1.
    while (Date.now() - startedAt < 48_000) {
      const r = await runChainDetectionBatch(offset, 1500, counts);
      processed += r.processed;
      flagged += r.flagged;
      suspected += r.suspected;
      cleared += r.cleared;
      skippedDismissed += r.skippedDismissed;
      skippedExempt += r.skippedExempt;
      for (const [k, v] of Object.entries(r.byRule)) byRule[k] = (byRule[k] ?? 0) + v;
      nextOffset = r.nextOffset;
      if (nextOffset === -1) break;
      offset = nextOffset;
    }
    const complete = nextOffset === -1;
    if (complete) {
      const stats = await countChainStats();
      const db = sql();
      const ruleRows = (await db`
        SELECT split_part(chain_reason, ':', 1) AS rule, COUNT(*)::int AS n
        FROM mi_companies WHERE is_chain = true GROUP BY 1 ORDER BY 2 DESC`) as unknown as Record<string, unknown>[];
      const byRuleDb = ruleRows
        .map((r) => `${String(r.rule)}=${Number(r.n)}`)
        .join(", ");
      await logSync(
        "chain-detect",
        "ok",
        flagged,
        `Chain detection pass complete from offset ${startOffset}: ${processed} records judged — ${flagged} newly flagged chain/franchise, ${suspected} newly tagged "Possible franchise", ${cleared} cleared; ${skippedDismissed} dismissed skipped, ${skippedExempt} exempt skipped. New flags by rule: ${Object.entries(byRule).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}.`
      );
      await logSync(
        "chain-detect-xcheck",
        "ok",
        stats.chain,
        `Recount from mi_companies: ${stats.chain} chain-flagged (${byRuleDb || "none"}), ${stats.suspect} "Possible franchise" suspects, ${stats.exempt} exempt overrides, ${stats.chainFits} chain-flagged rows still in the fit stage (excluded from the fits feed + counts by the is_chain filter).`
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
      byRule,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
