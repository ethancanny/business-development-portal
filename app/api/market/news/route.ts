import { NextRequest, NextResponse } from "next/server";
import { getNewsForUi, type NewsQuery } from "@/lib/news-db";

/**
 * News & Intelligence feed for the UI (session-gated by middleware).
 * GET /api/market/news?sector=&type=entity|sector|event|watchlist&days=&saved=1&limit=&offset=&sort=relevance|recent&deal=1
 * Display gates live in getNewsForUi (hard-excluded categories and
 * link-less stories never return; the main feed enforces the relevance
 * threshold). raw_snippet is internal matching/debug data and is never
 * returned here.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const typeRaw = sp.get("type") ?? "";
  const type = (["entity", "sector", "event", "watchlist"].includes(typeRaw) ? typeRaw : undefined) as NewsQuery["type"];
  const days = Number(sp.get("days") ?? 0);
  const limit = Number(sp.get("limit") ?? 50);
  const offset = Number(sp.get("offset") ?? 0);
  const sort = sp.get("sort") === "recent" ? "recent" : "relevance";
  try {
    const result = await getNewsForUi({
      sector: sp.get("sector") ?? undefined,
      type,
      days: Number.isFinite(days) && days > 0 ? days : undefined,
      savedOnly: sp.get("saved") === "1",
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
      sort,
      dealOnly: sp.get("deal") === "1",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
