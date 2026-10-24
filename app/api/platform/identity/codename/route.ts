import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getDeals, saveDeals } from "@/lib/db";

/**
 * Set/clear a deal's codename + external-display toggle. Goes
 * through the standard deals round-trip (getDeals/saveDeals) so the
 * values persist with the BD record exactly like every other deal
 * field — no side channel.
 */
export async function PATCH(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "guest") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const dealId = typeof body.dealId === "string" ? body.dealId : "";
  if (!dealId) {
    return NextResponse.json({ error: "dealId required" }, { status: 400 });
  }
  const deals = await getDeals();
  const idx = deals.findIndex((d) => d.id === dealId);
  if (idx < 0) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  const deal = { ...deals[idx] };
  if (typeof body.codename === "string") {
    deal.codename = body.codename.trim().slice(0, 80);
  }
  if (typeof body.codenameExternal === "boolean") {
    deal.codenameExternal = body.codenameExternal;
  }
  deal.updatedAt = new Date().toISOString();
  deals[idx] = deal;
  await saveDeals(deals);
  return NextResponse.json({
    ok: true,
    dealId,
    codename: deal.codename ?? "",
    codenameExternal: deal.codenameExternal !== false,
  });
}
