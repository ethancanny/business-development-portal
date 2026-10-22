import { NextRequest, NextResponse } from "next/server";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { getRoomIndex } from "@/lib/dataroom/service";
import { logAccess, validateGuestToken } from "@/lib/dataroom/guests";
import { listThreads } from "@/lib/dataroom/qa";

/** Guest responses carry access decisions — they must never be stored
 * by any cache layer. (A cached 200 kept revoked links working in
 * production even with force-dynamic set; no-store ends that class.) */
function jsonNoStore(body: unknown, init?: { status?: number }): NextResponse {
  const res = NextResponse.json(body, init ?? {});
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}


// NEVER cache: this handler reads no request/session API, so Next.js
// would otherwise treat the GET as static and serve the first response
// forever — which kept revoked/expired guest links working. Every call
// must re-validate the token against the database.
export const dynamic = "force-dynamic";

/**
 * Guest data-room view. NO session auth — the room token in the path
 * is the credential (middleware lists /api/guest as public for this
 * reason). Every call re-validates the token: hash lookup, expiry,
 * revocation, room status, and the room's current domain allowlist.
 */

function failure(reason: string): NextResponse {
  switch (reason) {
    case "expired":
      return jsonNoStore(
        { error: "expired", message: "This data room link has expired." },
        { status: 410 }
      );
    case "revoked":
      return jsonNoStore(
        { error: "revoked", message: "This data room link has been revoked." },
        { status: 403 }
      );
    case "room_inactive":
      return jsonNoStore(
        { error: "room_inactive", message: "This data room is not currently available." },
        { status: 403 }
      );
    default:
      return jsonNoStore(
        { error: "not_found", message: "This data room link is not valid." },
        { status: 404 }
      );
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  await ensureDataRoom();
  const v = await validateGuestToken(params.token);
  if (!v.ok) return failure(v.reason);
  const index = await getRoomIndex(v.room.id);
  if (!index) return failure("room_inactive");
  const qa = await listThreads(v.room.id);
  await logAccess({
    roomId: v.room.id,
    actor: v.guest.email,
    actorKind: "guest",
    action: "view_room",
  });
  return jsonNoStore({
    guest: {
      email: v.guest.email,
      name: v.guest.name,
      accessLevel: v.guest.accessLevel,
      expiresAt: v.guest.expiresAt,
    },
    room: {
      id: index.room.id,
      name: index.room.name,
      dealName: index.room.dealName,
      status: index.room.status,
    },
    folders: index.folders,
    unfiled: index.unfiled,
    checklist: index.checklist.map((c) => ({
      id: c.id,
      folderId: c.folderId,
      label: c.label,
      required: c.required,
      status: c.status,
    })),
    completeness: {
      total: index.completeness.total,
      satisfied: index.completeness.satisfied,
      pct: index.completeness.pct,
    },
    qa,
  });
}
