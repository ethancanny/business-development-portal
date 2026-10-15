import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getPendingSummaries } from "@/lib/news-db";

/**
 * Stories still waiting for an agent-written summary (redesign Wave 2).
 * GET /api/market/news/pending?limit=25
 * Auth: portal session OR Bearer CRON_SECRET (the summary runner is a
 * scheduled agent job with no session cookie; middleware lets this path
 * through and the check happens here, same pattern as /api/market/rescore).
 */
function authorized(req: NextRequest): boolean {
  if (getSessionUser()) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 25);
  try {
    const items = await getPendingSummaries(Number.isFinite(limit) ? limit : 25);
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
