import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  ensurePlatform,
  listDuplicates,
  mergeDuplicates,
} from "@/lib/platform/service";

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const kind = req.nextUrl.searchParams.get("kind") ?? "companies";
  if (kind !== "companies" && kind !== "people") {
    return NextResponse.json(
      { error: "kind must be 'companies' or 'people'" },
      { status: 400 }
    );
  }
  const pairs = await listDuplicates(kind);
  return NextResponse.json({ pairs });
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as {
    kind?: unknown;
    keepId?: unknown;
    mergeId?: unknown;
  };
  const kind = typeof body.kind === "string" ? body.kind : "";
  const keepId = typeof body.keepId === "string" ? body.keepId : "";
  const mergeId = typeof body.mergeId === "string" ? body.mergeId : "";
  if (kind !== "companies" && kind !== "people") {
    return NextResponse.json(
      { error: "kind must be 'companies' or 'people'" },
      { status: 400 }
    );
  }
  if (!keepId || !mergeId) {
    return NextResponse.json(
      { error: "keepId and mergeId are required" },
      { status: 400 }
    );
  }
  const result = await mergeDuplicates(kind, keepId, mergeId, user.name);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
