import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getDdPlansSummary, pageOptsFrom } from "@/lib/hubs/dd";

/**
 * GET /api/platform/hubs/dd-plans — one compact card per value
 * creation plan: 100-day window progress, initiative health buckets
 * (stored statuses + dates — see lib/hubs/dd.ts), and an impact
 * preview from the plan's STORED summary / scenario bridge (never
 * recomputed on this read).
 */
export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  try {
    const data = await getDdPlansSummary(pageOptsFrom(req.nextUrl.searchParams));
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    console.error(
      "[hubs:dd-plans]",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
