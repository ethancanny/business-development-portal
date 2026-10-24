import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { listRecentDeals, recordRecentOpen } from "@/lib/identity/service";

/**
 * Recent deals (top-bar dropdown): GET lists the signed-in user's
 * last 8 opened deals; POST records an open (fired once by the
 * company profile / deal page on mount — one cheap upsert, no
 * polling anywhere in this system).
 */
export async function GET() {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const items = await listRecentDeals(user.email);
  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const companyId = typeof body.companyId === "string" ? body.companyId : "";
  const dealId = typeof body.dealId === "string" ? body.dealId : "";
  if (!companyId && !dealId) {
    return NextResponse.json(
      { error: "companyId or dealId required" },
      { status: 400 }
    );
  }
  let resolvedCompany = companyId;
  if (!resolvedCompany && dealId) {
    const { dealIdentityForDeal } = await import("@/lib/identity/service");
    const d = await dealIdentityForDeal(dealId).catch(() => null);
    resolvedCompany = d?.companyId ?? "";
  }
  if (resolvedCompany) {
    await recordRecentOpen(user.email, resolvedCompany, dealId);
  }
  return NextResponse.json({ ok: true });
}
