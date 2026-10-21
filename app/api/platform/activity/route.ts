import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { listActivity } from "@/lib/platform/collab";

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const sp = req.nextUrl.searchParams;
  const raw = Number(sp.get("limit") ?? 25);
  const limit = Math.min(50, Math.max(1, isFinite(raw) ? raw : 25));
  const items = await listActivity({
    entityKind: sp.get("entityKind") ?? undefined,
    entityId: sp.get("entityId") ?? undefined,
    limit,
  });
  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
