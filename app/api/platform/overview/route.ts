import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform, getOverviewData } from "@/lib/platform/service";

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const raw = Number(req.nextUrl.searchParams.get("cards") ?? 24);
  const cardsLimit = Math.min(50, Math.max(1, isFinite(raw) ? raw : 24));
  const data = await getOverviewData(cardsLimit);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
