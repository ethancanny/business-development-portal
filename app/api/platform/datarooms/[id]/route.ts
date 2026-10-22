import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { getRoom, getRoomIndex, updateRoom } from "@/lib/dataroom/service";
import { listGuests } from "@/lib/dataroom/guests";
import { getStorageStatus } from "@/lib/storage";

/** Room detail: room + folder/document index + checklist + completeness
 * + guests + provider status, composed from the dataroom services. */
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
  const guests = await listGuests(params.id);
  const provider = await getStorageStatus();
  return NextResponse.json(
    {
      room: index.room,
      folders: index.folders,
      unfiled: index.unfiled,
      checklist: index.checklist,
      completeness: index.completeness,
      openQaCount: index.openQaCount,
      guests,
      provider,
    },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const room = await getRoom(params.id);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const updated = await updateRoom(
      params.id,
      {
        name: typeof body.name === "string" ? body.name : undefined,
        domainAllowlist: Array.isArray(body.domainAllowlist)
          ? body.domainAllowlist.map((d) => String(d))
          : undefined,
        status: typeof body.status === "string" ? body.status : undefined,
      },
      user.name || user.email
    );
    return NextResponse.json({ room: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
