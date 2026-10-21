import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDirectory, TYPE_TAXONOMY } from "@/lib/directory/schema";
import { setTypeTag } from "@/lib/directory/service";

export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ types: TYPE_TAXONOMY });
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDirectory();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const entityKind =
    typeof body.entityKind === "string"
      ? body.entityKind
      : typeof body.entity_kind === "string"
        ? body.entity_kind
        : typeof body.kind === "string"
          ? body.kind
          : "";
  const entityId =
    typeof body.entityId === "string"
      ? body.entityId
      : typeof body.entity_id === "string"
        ? body.entity_id
        : typeof body.id === "string"
          ? body.id
          : "";
  const type = typeof body.type === "string" ? body.type : "";
  const action =
    body.action === "remove" ? "remove" : body.action === "add" ? "add" : "";
  if (!entityKind || !entityId || !type || !action) {
    return NextResponse.json(
      { error: "entityKind, entityId, type and action ('add'|'remove') are required" },
      { status: 400 }
    );
  }
  const result = await setTypeTag({
    entityKind,
    entityId,
    type,
    action: action as "add" | "remove",
    actor: user.name || user.email,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
