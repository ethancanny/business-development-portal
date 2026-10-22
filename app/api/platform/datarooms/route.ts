import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { createRoom, listRooms } from "@/lib/dataroom/service";

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const sp = req.nextUrl.searchParams;
  const limitRaw = Number(sp.get("limit") ?? 25);
  const offsetRaw = Number(sp.get("offset") ?? 0);
  const { items, total } = await listRooms({
    limit: Math.min(50, Math.max(1, isFinite(limitRaw) ? limitRaw : 25)),
    offset: Math.max(0, isFinite(offsetRaw) ? offsetRaw : 0),
  });
  return NextResponse.json(
    { items, total },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const dealId = typeof body.dealId === "string" ? body.dealId : "";
  if (!dealId) {
    return NextResponse.json({ error: "dealId is required" }, { status: 400 });
  }
  try {
    const { room, existed } = await createRoom(
      {
        dealId,
        name: typeof body.name === "string" ? body.name : undefined,
        templateId:
          typeof body.templateId === "string" ? body.templateId : undefined,
      },
      user.name || user.email
    );
    return NextResponse.json({ room, existed }, { status: existed ? 200 : 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
