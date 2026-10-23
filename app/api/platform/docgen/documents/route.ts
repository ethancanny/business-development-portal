import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { listGenerations } from "@/lib/docgen/generate";

/** Generated documents list. Filter with ?dealId= and/or ?companyId=. */
export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const sp = req.nextUrl.searchParams;
  const limitRaw = Number(sp.get("limit") ?? 25);
  const offsetRaw = Number(sp.get("offset") ?? 0);
  const { items, total } = await listGenerations({
    dealId: sp.get("dealId") ?? undefined,
    companyId: sp.get("companyId") ?? undefined,
    limit: Math.min(50, Math.max(1, isFinite(limitRaw) ? limitRaw : 25)),
    offset: Math.max(0, isFinite(offsetRaw) ? offsetRaw : 0),
  });
  return NextResponse.json(
    { items, total },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
