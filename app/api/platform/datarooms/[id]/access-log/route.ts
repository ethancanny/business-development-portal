import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { getRoom } from "@/lib/dataroom/service";
import { getRoomAccessLog } from "@/lib/dataroom/guests";

/** Access log is fetched ON DEMAND and cached 15 min (rules);
 * ?fresh=1 bypasses the cache for an up-to-the-minute read. */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const room = await getRoom(params.id);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  const result = await getRoomAccessLog(room, { fresh });
  return NextResponse.json(result);
}
