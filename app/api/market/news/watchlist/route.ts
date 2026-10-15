import { NextRequest, NextResponse } from "next/server";
import { getWatchlist, addWatchTerm, deleteWatchTerm } from "@/lib/news-db";

/**
 * News watchlist — names/keywords that always surface in the feed
 * (session-gated by middleware).
 * GET    /api/market/news/watchlist           → { terms }
 * POST   /api/market/news/watchlist { term }  → add
 * DELETE /api/market/news/watchlist { term }  → remove (or ?term=)
 */
export async function GET() {
  try {
    return NextResponse.json({ ok: true, terms: await getWatchlist() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { term?: unknown };
  const term = String(body.term ?? "").trim();
  if (!term) return NextResponse.json({ error: "Body must be { term }" }, { status: 400 });
  try {
    await addWatchTerm(term);
    return NextResponse.json({ ok: true, terms: await getWatchlist() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { term?: unknown };
  const term = String(body.term ?? req.nextUrl.searchParams.get("term") ?? "").trim();
  if (!term) return NextResponse.json({ error: "Provide { term } or ?term=" }, { status: 400 });
  try {
    await deleteWatchTerm(term);
    return NextResponse.json({ ok: true, terms: await getWatchlist() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
