import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getDdRoomsSummary, pageOptsFrom } from "@/lib/hubs/dd";

/**
 * GET /api/platform/hubs/dd-rooms — data rooms listed by company:
 * completeness, missing checklist count, status, and last activity.
 * lastActivityAt is the room's updated_at — the dataroom service
 * exposes no separate activity timestamp (named here so the hub
 * never presents it as something it isn't).
 */
export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  try {
    const data = await getDdRoomsSummary(pageOptsFrom(req.nextUrl.searchParams));
    return NextResponse.json(
      { ...data, lastActivitySource: "room.updated_at" },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (err) {
    console.error(
      "[hubs:dd-rooms]",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
