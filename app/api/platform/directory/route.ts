import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAccessContext } from "@/lib/platform/permissions";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDirectory } from "@/lib/directory/schema";
import {
  createRecord,
  listDirectory,
  updateRecord,
} from "@/lib/directory/service";

export async function GET(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Phase 9: the Directory is internal-only — company-scoped
  // management sessions never see it.
  const ctx = await getAccessContext(user);
  if (ctx.companyIds !== null) {
    return NextResponse.json({ error: "internal_only" }, { status: 403 });
  }
  await ensurePlatform();
  await ensureDirectory();
  const sp = req.nextUrl.searchParams;
  const limitRaw = Number(sp.get("limit") ?? 25);
  const offsetRaw = Number(sp.get("offset") ?? 0);
  const { items, total } = await listDirectory({
    // People only (Ethan, Oct 23, 2026): the Directory is a contacts
    // list — a contact's company must not appear as a second contact.
    // Organization records stay in core.organizations and remain
    // reachable via the record routes; only this list is scoped.
    kind: "person",
    type: sp.get("type") ?? undefined,
    q: sp.get("q") ?? undefined,
    limit: Math.min(50, Math.max(1, isFinite(limitRaw) ? limitRaw : 25)),
    offset: Math.max(0, isFinite(offsetRaw) ? offsetRaw : 0),
  });
  return NextResponse.json(
    { items, total },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDirectory();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "";
  // Presence of an id = update (the Directory detail edit form posts
  // here); otherwise this is a create.
  if (typeof body.id === "string" && body.id) {
    try {
      const updated = await updateRecord(
        kind,
        body.id,
        body,
        user.name || user.email
      );
      if (!updated) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ record: updated });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }
  }
  const name = typeof body.name === "string" ? body.name : "";
  if (!kind || !name.trim()) {
    return NextResponse.json(
      { error: "kind and name are required" },
      { status: 400 }
    );
  }
  try {
    const record = await createRecord({
      kind,
      name,
      title: typeof body.title === "string" ? body.title : undefined,
      email: typeof body.email === "string" ? body.email : undefined,
      phone: typeof body.phone === "string" ? body.phone : undefined,
      organizationName:
        typeof body.organizationName === "string"
          ? body.organizationName
          : typeof body.organization_name === "string"
            ? body.organization_name
            : undefined,
      website: typeof body.website === "string" ? body.website : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      photoUrl: typeof body.photoUrl === "string" ? body.photoUrl : undefined,
      types: body.types as string[] | string | undefined,
      actor: user.name || user.email,
    });
    return NextResponse.json({ record }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
