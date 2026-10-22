import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { listDocuments } from "@/lib/dataroom/documents";

/** Documents library: every document across deals, metadata only,
 * searchable by name AND extracted content (via core.documents'
 * search_vector, maintained by the extraction job). */
export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const sp = req.nextUrl.searchParams;
  const limitRaw = Number(sp.get("limit") ?? 25);
  const offsetRaw = Number(sp.get("offset") ?? 0);
  const { items, total } = await listDocuments({
    q: sp.get("q") ?? undefined,
    dealId: sp.get("dealId") ?? undefined,
    companyId: sp.get("companyId") ?? undefined,
    tag: sp.get("tag") ?? undefined,
    mime: sp.get("mime") ?? undefined,
    limit: Math.min(50, Math.max(1, isFinite(limitRaw) ? limitRaw : 25)),
    offset: Math.max(0, isFinite(offsetRaw) ? offsetRaw : 0),
  });
  return NextResponse.json(
    { items, total },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
