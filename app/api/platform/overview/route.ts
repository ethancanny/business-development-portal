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
  // Activity pulse (Oct 23, 2026): live triage counts + latest items
  // from the deal-flow store, same additive pattern as earlyWarning.
  // The predicate (status 'new' AND never read) is the BD hub's own
  // (lib/hubs/bd.ts) — the widget can never disagree with the badge.
  let activityPulse: unknown = null;
  try {
    const { getBdActivitySummary } = await import("@/lib/hubs/bd");
    activityPulse = await getBdActivitySummary();
  } catch (err) {
    console.error(
      "[overview] activity pulse read failed",
      err instanceof Error ? err.message : String(err)
    );
    activityPulse = null;
  }
  return NextResponse.json(
    { ...data, earlyWarning, activityPulse },
    {
      headers: { "Cache-Control": "private, max-age=300" },
    }
  );
}
