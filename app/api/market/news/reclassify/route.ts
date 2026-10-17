import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { reclassifyAllNews } from "@/lib/news-db";
import { logSync } from "@/lib/market-db";

/**
 * News overhaul maintenance pass (Oct 17, 2026): re-run the sector
 * classifier + relevance model over every stored story and report the
 * before/after deltas. POST /api/market/news/reclassify
 * Auth: portal session OR Bearer <redacted> (middleware lets this
 * path through; the check happens here, mirroring the summary route).
 */
function authorized(req: NextRequest): boolean {
  if (getSessionUser()) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const report = await reclassifyAllNews();
    const verdict =
      `total ${report.total} · updated ${report.updated} · sector-changed ${report.sectorChanged} · ` +
      `hard-excluded ${report.hardExcluded} (${Object.entries(report.hardByCategory).map(([c, n]) => `${c} ${n}`).join(", ") || "none"}) · ` +
      `below-threshold ${report.belowThreshold} · no-url ${report.noUrl} · low-confidence ${report.lowConfidence}` +
      (report.korea
        ? ` · KOREA: "${report.korea.headline.slice(0, 60)}" ${report.korea.from ?? "null"} → ${report.korea.to ?? "null"} (conf ${report.korea.confidence}, score ${report.korea.score})`
        : " · KOREA: not in corpus");
    await logSync("intel-news-reclassify", "ok", report.updated, verdict.slice(0, 950));
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logSync("intel-news-reclassify", "error", 0, msg.slice(0, 950)).catch(() => undefined);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
