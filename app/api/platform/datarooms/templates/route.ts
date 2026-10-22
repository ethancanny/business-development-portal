import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { listTemplates, saveTemplate } from "@/lib/dataroom/service";
import type { RoomTemplateStructure } from "@/lib/dataroom/schema";

export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const templates = await listTemplates();
  return NextResponse.json({ templates });
}

/** Create or update a room template (Settings → Data Rooms). */
export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const structure = body.structure as RoomTemplateStructure | undefined;
  if (!name || !structure || !Array.isArray(structure.folders)) {
    return NextResponse.json(
      { error: "name and structure.folders are required" },
      { status: 400 }
    );
  }
  try {
    const template = await saveTemplate(
      {
        id: typeof body.id === "string" ? body.id : undefined,
        name,
        structure,
        isDefault: body.isDefault === true,
      },
      user.name || user.email
    );
    return NextResponse.json({ template });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
