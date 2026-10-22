import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { revokeGuest } from "@/lib/dataroom/guests";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; guestId: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const ok = await revokeGuest(params.id, params.guestId, user.name || user.email);
  if (!ok) {
    return NextResponse.json(
      { error: "Guest grant not found or already revoked" },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
