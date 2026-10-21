import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDirectory } from "@/lib/directory/schema";
import {
  getDirectoryDetail,
  normalizeEntityKind,
  updateRecord,
} from "@/lib/directory/service";

export async function GET(
  _req: NextRequest,
  { params }: { params: { kind: string; id: string } }
) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!normalizeEntityKind(params.kind)) {
    return NextResponse.json(
      { error: "kind must be 'person' or 'organization'" },
      { status: 400 }
    );
  }
  await ensurePlatform();
  await ensureDirectory();
  const detail = await getDirectoryDetail(params.kind, params.id);
  if (!detail) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }
  return NextResponse.json(detail, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { kind: string; id: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!normalizeEntityKind(params.kind)) {
    return NextResponse.json(
      { error: "kind must be 'person' or 'organization'" },
      { status: 400 }
    );
  }
  await ensurePlatform();
  await ensureDirectory();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const record = await updateRecord(
      params.kind,
      params.id,
      body,
      user.name || user.email
    );
    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
