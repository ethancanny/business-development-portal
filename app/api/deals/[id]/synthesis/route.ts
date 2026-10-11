import { NextRequest, NextResponse } from "next/server";
import { getDeals, saveDeals } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

/** Store the agent's written valuation synthesis on a deal.
 * Auth: a partner session, or the CRON_SECRET bearer the scheduled
 * synthesis job uses. The synthesis is a stored read, not an edit —
 * it deliberately does NOT bump the deal's updatedAt, so a refresh
 * never makes a deal look freshly touched or resets stale logic. */

function authorized(req: NextRequest): boolean {
  if (getSessionUser()) return true;
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return false;
}

type Params = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Params) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  const deals = await getDeals();
  const idx = deals.findIndex((d) => d.id === params.id);
  if (idx === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const synthesis = {
    text: text.slice(0, 8000),
    inputsHash: String(body.inputsHash ?? "").slice(0, 64),
    updatedAt: new Date().toISOString(),
    author: String(body.author ?? "Muse").slice(0, 40),
  };
  deals[idx] = { ...deals[idx], synthesis };
  await saveDeals(deals);
  return NextResponse.json({ ok: true, synthesis });
}
