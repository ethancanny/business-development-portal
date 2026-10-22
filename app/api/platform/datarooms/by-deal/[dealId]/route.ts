import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { getRoomResolutionByDeal } from "@/lib/dataroom/service";

/**
 * GET /api/platform/datarooms/by-deal/[dealId] — the deal-scoped twin
 * of by-company, for the diligence workspace header's Data Room
 * button (DataRoomButton's {dealId} variant). Same contract: 200
 * with roomId null when the deal has no room yet.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const { roomId, roomCount } = await getRoomResolutionByDeal(params.dealId);
  return NextResponse.json(
    { roomId, roomCount },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
