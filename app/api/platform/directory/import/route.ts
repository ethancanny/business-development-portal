import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDirectory } from "@/lib/directory/schema";
import { importRows } from "@/lib/directory/service";

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDirectory();
  const body = (await req.json().catch(() => ({}))) as {
    rows?: unknown;
    mapping?: unknown;
    kind?: unknown;
    dryRun?: unknown;
  };
  // CRM Phase 1: dryRun passthrough — importRows (Lane A extension)
  // runs identical validation/dedupe and reports
  // { wouldCreate, wouldSkip, errors } with zero writes.
  const dryRun = body.dryRun === true || body.dryRun === "true" || body.dryRun === 1;
  const rows = Array.isArray(body.rows)
    ? (body.rows as Record<string, string>[])
    : [];
  const mapping =
    body.mapping && typeof body.mapping === "object"
      ? (body.mapping as Record<string, string>)
      : {};
  const kind = typeof body.kind === "string" ? body.kind : "";
  if (!kind || !rows.length || !Object.keys(mapping).length) {
    return NextResponse.json(
      { error: "kind, rows (non-empty) and mapping are required" },
      { status: 400 }
    );
  }
  if (rows.length > 1000) {
    return NextResponse.json(
      { error: "import is capped at 1000 rows per request" },
      { status: 400 }
    );
  }
  try {
    // The dryRun field is Lane A's importRows extension (DESIGN.md);
    // the cast bridges Lane B's tree, where service.ts predates it.
    const result = await importRows({
      rows,
      mapping,
      kind,
      actor: user.name || user.email,
      dryRun,
    } as unknown as Parameters<typeof importRows>[0]);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
