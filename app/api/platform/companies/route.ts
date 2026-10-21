import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  countCompanies,
  ensurePlatform,
  listCompanies,
} from "@/lib/platform/service";

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const sp = req.nextUrl.searchParams;
  const limitRaw = Number(sp.get("limit") ?? 25);
  const offsetRaw = Number(sp.get("offset") ?? 0);
  const filters = {
    stage: sp.get("stage") ?? undefined,
    vertical: sp.get("vertical") ?? undefined,
    q: sp.get("q") ?? undefined,
    limit: Math.min(50, Math.max(1, isFinite(limitRaw) ? limitRaw : 25)),
    offset: Math.max(0, isFinite(offsetRaw) ? offsetRaw : 0),
  };
  const companies = await listCompanies(filters);
  const total = await countCompanies(filters);
  return NextResponse.json(
    { companies, total },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
