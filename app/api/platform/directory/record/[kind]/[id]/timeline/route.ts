import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAccessContext } from "@/lib/platform/permissions";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDirectory } from "@/lib/directory/schema";
import { normalizeEntityKind } from "@/lib/directory/service";
import { ensureCrm, getTimeline } from "@/lib/directory/crm";

/**
 * CRM Phase 1 — unified record timeline. Nested under the existing
 * record route (record/[kind]/[id]/route.ts) exactly as DESIGN.md
 * specifies: record/[kind]/[id]/timeline. Kind validation mirrors
 * the sibling record route (normalizeEntityKind → 400).
 */

export async function GET(
  req: NextRequest,
  { params }: { params: { kind: string; id: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ctx = await getAccessContext(user);
  if (ctx.companyIds !== null) {
    return NextResponse.json({ error: "internal_only" }, { status: 403 });
  }
  const kind = normalizeEntityKind(params.kind);
  if (!kind) {
    return NextResponse.json(
      { error: "kind must be 'person' or 'organization'" },
      { status: 400 }
    );
  }
  await ensurePlatform();
  await ensureDirectory();
  await ensureCrm();
  const sp = req.nextUrl.searchParams;
  const kindsRaw = sp.get("kinds") ?? "";
  const kinds = kindsRaw
    ? kindsRaw.split(",").map((k) => k.trim()).filter(Boolean)
    : undefined;
  const limitRaw = Number(sp.get("limit") ?? 20);
  const offsetRaw = Number(sp.get("offset") ?? 0);
  const { items, total } = await getTimeline(kind, params.id, {
    kinds,
    limit: Math.min(50, Math.max(1, isFinite(limitRaw) ? limitRaw : 20)),
    offset: Math.max(0, isFinite(offsetRaw) ? offsetRaw : 0),
  });
  return NextResponse.json(
    { items, total },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
