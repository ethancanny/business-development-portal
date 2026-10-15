import { NextRequest, NextResponse } from "next/server";
import { applyNewsAction, type NewsAction } from "@/lib/news-db";

/**
 * News item actions (session-gated by middleware).
 * POST /api/market/news/action { id, action: save|unsave|dismiss|link, companyId? }
 * "link" appends the story as a signal on the company record (the filings
 * Keep mechanism) and stamps linked_company_id on the news row.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    id?: unknown;
    action?: unknown;
    companyId?: unknown;
  };
  const id = String(body.id ?? "");
  const action = String(body.action ?? "") as NewsAction;
  if (!id || !["save", "unsave", "dismiss", "link"].includes(action)) {
    return NextResponse.json({ error: "Body must be { id, action: save|unsave|dismiss|link }" }, { status: 400 });
  }
  try {
    const result = await applyNewsAction(id, action, body.companyId ? String(body.companyId) : undefined);
    if (!result.ok) {
      const notFound = /not found/i.test(result.error ?? "");
      return NextResponse.json({ error: result.error ?? "Action failed" }, { status: notFound ? 404 : 400 });
    }
    return NextResponse.json({ ok: true, companyId: result.companyId, companyName: result.companyName });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
