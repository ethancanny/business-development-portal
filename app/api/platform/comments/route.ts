import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import {
  createComment,
  deleteComment,
  listComments,
} from "@/lib/platform/collab";

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const sp = req.nextUrl.searchParams;
  const entityKind = sp.get("entityKind") ?? "";
  const entityId = sp.get("entityId") ?? "";
  if (!entityKind || !entityId) {
    return NextResponse.json(
      { error: "entityKind and entityId are required" },
      { status: 400 }
    );
  }
  const raw = Number(sp.get("limit") ?? 50);
  const limit = Math.min(50, Math.max(1, isFinite(raw) ? raw : 50));
  const comments = await listComments(entityKind, entityId, limit);
  return NextResponse.json(
    { comments },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as {
    entityKind?: unknown;
    entityId?: unknown;
    body?: unknown;
  };
  const entityKind = String(body.entityKind ?? "").trim();
  const entityId = String(body.entityId ?? "").trim();
  const text = String(body.body ?? "").trim();
  if (!entityKind || !entityId || !text) {
    return NextResponse.json(
      { error: "entityKind, entityId and body are required" },
      { status: 400 }
    );
  }
  const comment = await createComment({
    entityKind,
    entityId,
    body: text,
    author: user.name,
    actorEmail: user.email,
  });
  return NextResponse.json({ comment }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const result = await deleteComment(id, user.name);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Could not delete" },
      { status: 403 }
    );
  }
  return NextResponse.json({ ok: true });
}
