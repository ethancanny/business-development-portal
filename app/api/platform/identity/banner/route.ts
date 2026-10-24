import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import {
  dealIdentityForCompany,
  dealIdentityForDeal,
  getIdentity,
  listActiveDealIdentities,
} from "@/lib/identity/service";

/**
 * Deal banner payload: everything the slim sticky banner needs for a
 * company/deal page in ONE small read — company identity (logo
 * version, accent), the deal's stage/type/codename, and the active-
 * deal list for the quick switcher. Fetched once per page mount by
 * <DealBanner>; no polling.
 */
export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const sp = req.nextUrl.searchParams;
  const companyId = sp.get("companyId") ?? "";
  const dealId = sp.get("dealId") ?? "";

  let identity = companyId ? await getIdentity(companyId) : null;
  let deal = dealId
    ? await dealIdentityForDeal(dealId)
    : companyId
      ? await dealIdentityForCompany(companyId)
      : null;
  if (!identity && deal?.companyId) {
    identity = await getIdentity(deal.companyId);
  }
  if (!identity && !deal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const switcher = await listActiveDealIdentities();
  return NextResponse.json(
    {
      company: identity
        ? {
            id: identity.entityId,
            name: identity.name,
            logoVersion: identity.logoVersion,
            accentColor: identity.accentColor,
          }
        : null,
      deal: deal
        ? {
            id: deal.dealId,
            companyId: deal.companyId,
            name: deal.name,
            stage: deal.stage,
            investmentType: deal.investmentType,
            codename: deal.codename,
            codenameExternal: deal.codenameExternal,
          }
        : null,
      switcher: switcher.map((s) => ({
        dealId: s.dealId,
        companyId: s.companyId,
        name: s.name,
        stage: s.stage,
        codename: s.codename,
        logoVersion: s.logoVersion,
        accentColor: s.accentColor,
      })),
    },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
