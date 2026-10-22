import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { getRoomResolutionByCompany } from "@/lib/dataroom/service";

/**
 * GET /api/platform/datarooms/by-company/[companyId] — resolve the
 * company's most recent data room for header "Data Room" buttons.
 * 200 with roomId null when the company has no room (never a 404:
 * the button falls back to the rooms list where one can be created).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const { roomId, roomCount } = await getRoomResolutionByCompany(
    params.companyId
  );
  return NextResponse.json(
    { roomId, roomCount },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
