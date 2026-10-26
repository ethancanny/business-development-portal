import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAccessContext } from "@/lib/platform/permissions";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDirectory } from "@/lib/directory/schema";
import { normalizeEntityKind } from "@/lib/directory/service";
import { ensureCrm, mergeDirectoryRecords } from "@/lib/directory/crm";

/**
 * CRM Phase 1 — merge a duplicate Directory record into a keeper.
 * Body: { kind, keeperId, duplicateId } (aliases keepId/mergeId,
 * targetId/sourceId accepted). The service re-points directory-owned
 * rows, writes the audit entry, and returns { movedCounts }.
 */

const str = (v: unknown): string =>
  typeof v === "string" ? v.trim() : "";

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ctx = await getAccessContext(user);
  if (ctx.companyIds !== null) {
    return NextResponse.json({ error: "internal_only" }, { status: 403 });
  }
  await ensurePlatform();
  await ensureDirectory();
  await ensureCrm();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = normalizeEntityKind(body.kind);
  const keeperId = str(body.keeperId) || str(body.keepId) || str(body.targetId);
  const duplicateId =
    str(body.duplicateId) || str(body.mergeId) || str(body.sourceId);
  if (!kind || !keeperId || !duplicateId) {
    return NextResponse.json(
      { error: "kind, keeperId and duplicateId are required" },
      { status: 400 }
    );
  }
  if (keeperId === duplicateId) {
    return NextResponse.json(
      { error: "keeperId and duplicateId must differ" },
      { status: 400 }
    );
  }
  try {
    const result = await mergeDirectoryRecords(
      kind,
      keeperId,
      duplicateId,
      user.name || user.email
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
