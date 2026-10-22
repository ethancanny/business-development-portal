import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getBdActivitySummary } from "@/lib/hubs/bd";

/**
 * GET /api/platform/hubs/bd-activity — compact Business Development
 * hub summary for Activity: unread-new counts per kind and the
 * latest triage items from the deal-flow store. Aggregated in
 * lib/hubs/bd.ts; compact fields only.
 */
export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const data = await getBdActivitySummary();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
