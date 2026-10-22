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
  // Phase 9 (additive): portfolio early-warning read model from
  // lib/portmgmt/service.ts. Dynamic import + try/catch so the
  // Overview never fails on the monitoring module — null on error.
  let earlyWarning: unknown = null;
  try {
    const { getEarlyWarningOverview } = await import(
      "@/lib/portmgmt/service"
    );
    earlyWarning = await getEarlyWarningOverview();
  } catch (err) {
    console.error(
      "[overview] early-warning read failed",
      err instanceof Error ? err.message : String(err)
    );
    earlyWarning = null;
  }
  return NextResponse.json(
    { ...data, earlyWarning },
    {
      headers: { "Cache-Control": "private, max-age=300" },
    }
  );
}
