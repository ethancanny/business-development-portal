import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { searchAll } from "@/lib/platform/search";

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") ?? "";
  const type = sp.get("type") ?? undefined;
  const limitRaw = Number(sp.get("limit") ?? 20);
  const limit = Math.min(50, Math.max(1, isFinite(limitRaw) ? limitRaw : 20));
  const results = await searchAll(q, type, limit);
  return NextResponse.json(
    { results },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
