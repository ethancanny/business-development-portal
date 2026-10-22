import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getDdWorkspacesSummary, pageOptsFrom } from "@/lib/hubs/dd";

/**
 * GET /api/platform/hubs/dd-workspaces — one compact card per deal
 * WITH a diligence workspace: company, claimed-by owner, checklist
 * progress by the 9 workstreams, OPEN findings by severity (proposed
 * findings + open/mitigating red flags), and the next milestone.
 * Aggregated in lib/hubs/dd.ts via the diligence service only.
 */
export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  try {
    const data = await getDdWorkspacesSummary(
      pageOptsFrom(req.nextUrl.searchParams)
    );
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    console.error(
      "[hubs:dd-workspaces]",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
