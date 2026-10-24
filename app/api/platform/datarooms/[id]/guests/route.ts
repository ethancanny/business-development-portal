import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { getRoom } from "@/lib/dataroom/service";
import { createGuest, listGuests } from "@/lib/dataroom/guests";

export async function GET(
  _req: NextRequest,
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
  const guests = await listGuests(params.id);
  return NextResponse.json({ guests });
}

export async function POST(
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
    const { guest, token, path } = await createGuest(
      params.id,
      {
        email: typeof body.email === "string" ? body.email : "",
        name: typeof body.name === "string" ? body.name : undefined,
        accessLevel:
          typeof body.accessLevel === "string" ? body.accessLevel : undefined,
        expiresAt:
          typeof body.expiresAt === "string" ? body.expiresAt : undefined,
        expiresInDays:
          typeof body.expiresInDays === "number" ? body.expiresInDays : undefined,
      },
      user.name || user.email
    );
    // The raw token is returned exactly once — only its hash is stored.
    return NextResponse.json(
      { guest, link: path, token },
      { status: 201 }
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        code: code ?? undefined,
      },
      {
        status:
          code === "domain_not_allowed"
            ? 422
            : code === "guest_not_approved"
              ? 403
              : 400,
      }
    );
  }
}
