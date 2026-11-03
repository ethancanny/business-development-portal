import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform, getOverviewData } from "@/lib/platform/service";
import { datasetVersionHeader } from "@/lib/platform/versions";

/**
 * Overview payload assembly (perf pass, Nov 2, 2026): the three
 * additive reads (early warning, activity pulse, flywheel) are
 * independent — they now run in parallel instead of sequentially.
 * Each keeps its failure isolation: null on error, never sinks the
 * Overview.
 */
async function assembleOverview(cardsLimit: number) {
  const data = await getOverviewData(cardsLimit);
  // Phase 9 (additive): portfolio early-warning read model from
  // lib/portmgmt/service.ts. Dynamic import + try/catch so the
  // Overview never fails on the monitoring module — null on error.
  const earlyWarningP = (async (): Promise<unknown> => {
    try {
      const { getEarlyWarningOverview } = await import(
        "@/lib/portmgmt/service"
      );
      const earlyWarning: unknown = await getEarlyWarningOverview();
      // Deal Identity: attach logo versions so early-warning cards
      // render the company mark (decorative; never blocks Overview).
      if (Array.isArray(earlyWarning) && earlyWarning.length) {
        try {
          const { identitiesFor } = await import("@/lib/identity/service");
          const ids = (earlyWarning as Array<Record<string, unknown>>)
            .map((it) => (typeof it.companyId === "string" ? it.companyId : ""))
            .filter(Boolean);
          const map = await identitiesFor(ids);
          for (const it of earlyWarning as Array<Record<string, unknown>>) {
            const found = map.get(String(it.companyId ?? ""));
            if (found) it.logoVersion = found.logoVersion;
          }
        } catch {
          /* decorative */
        }
      }
      return earlyWarning;
    } catch (err) {
      console.error(
        "[overview] early-warning read failed",
        err instanceof Error ? err.message : String(err)
      );
      return null;
    }
  })();
  // Activity pulse (Oct 23, 2026): live triage counts + latest items
  // from the deal-flow store, same additive pattern as earlyWarning.
  // The predicate (status 'new' AND never read) is the BD hub's own
  // (lib/hubs/bd.ts) — the widget can never disagree with the badge.
  const activityPulseP = (async (): Promise<unknown> => {
    try {
      const { getBdActivitySummary } = await import("@/lib/hubs/bd");
      return await getBdActivitySummary();
    } catch (err) {
      console.error(
        "[overview] activity pulse read failed",
        err instanceof Error ? err.message : String(err)
      );
      return null;
    }
  })();
  // Flywheel (Investment Types Step 1, Oct 23, 2026): platform-company
  // cash flow (Portfolio Monitoring's stored rollup) vs capital
  // committed to closed early-stage investments — same additive,
  // failure-isolated pattern. Null on error; the panel shows its
  // honest empty state.
  const flywheelP = (async (): Promise<unknown> => {
    try {
      const { getFlywheel } = await import("@/lib/bd/service");
      return await getFlywheel();
    } catch (err) {
      console.error(
        "[overview] flywheel read failed",
        err instanceof Error ? err.message : String(err)
      );
      return null;
    }
  })();
  const [earlyWarning, activityPulse, flywheel] = await Promise.all([
    earlyWarningP,
    activityPulseP,
    flywheelP,
  ]);
  return { ...data, earlyWarning, activityPulse, flywheel };
}

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const raw = Number(req.nextUrl.searchParams.get("cards") ?? 24);
  const cardsLimit = Math.min(50, Math.max(1, isFinite(raw) ? raw : 24));
  // Light path (perf, Nov 2, 2026): this route is the Overview page's
  // spine and must not pay ensurePlatform's cold-instance schema/
  // backfill battery on the happy path. Assemble directly; only if
  // assembly throws (virgin deployment, schema not yet created) run
  // the ensure and retry once. The additive reads above already
  // degrade to null on missing tables, so a schema failure surfaces
  // at getOverviewData and lands here.
  let payload: Awaited<ReturnType<typeof assembleOverview>>;
  try {
    payload = await assembleOverview(cardsLimit);
  } catch {
    await ensurePlatform();
    payload = await assembleOverview(cardsLimit);
  }
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "private, max-age=300",
      ...(await datasetVersionHeader("overview")),
    },
  });
}
