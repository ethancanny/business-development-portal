import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { getRoomIndex } from "@/lib/dataroom/service";

/** The auto-generated room index (folders → documents + checklist).
 * Same shape Phase 5 (Due Diligence) consumes via the service layer. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const index = await getRoomIndex(params.id);
  if (!index) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  return NextResponse.json(index, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
