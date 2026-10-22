import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getBdPipelineSummary } from "@/lib/hubs/bd";

/**
 * GET /api/platform/hubs/bd-pipeline — compact Business Development
 * hub summary: deal counts + resolved values by stage, the stalest
 * open deals (30+ days, the push-evals stalled definition), and
 * open/stale totals. Aggregated in lib/hubs/bd.ts; compact fields
 * only.
 */
export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const data = await getBdPipelineSummary();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
