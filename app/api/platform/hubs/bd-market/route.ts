import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getBdMarketSummary } from "@/lib/hubs/bd";

/**
 * GET /api/platform/hubs/bd-market — compact Business Development
 * hub summary for Market Intel: fit total + top fits, per-sector
 * EV/EBITDA snapshot, tailwind scores, and the next market events.
 * Aggregated in lib/hubs/bd.ts from the existing market services;
 * compact fields only.
 */
export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const data = await getBdMarketSummary();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
