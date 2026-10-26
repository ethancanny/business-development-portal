import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAccessContext } from "@/lib/platform/permissions";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDirectory } from "@/lib/directory/schema";
import { normalizeEntityKind } from "@/lib/directory/service";
import { ensureCrm, listListMembers, addListMembers } from "@/lib/directory/crm";

/**
 * CRM Phase 1 — members of one list.
 * GET paginated (limit/offset). POST accepts any of:
 *   { members: [{ kind, id } | { entityKind, entityId }] }
 *   { kind, ids: [...] }  /  { entityKind, entityIds: [...] }
 */

async function gate(user: ReturnType<typeof getSessionUser>) {
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await getAccessContext(user);
  if (ctx.companyIds !== null) {
    return NextResponse.json({ error: "internal_only" }, { status: 403 });
  }
  await ensurePlatform();
  await ensureDirectory();
  await ensureCrm();
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  const blocked = await gate(user);
  if (blocked) return blocked;
  const sp = req.nextUrl.searchParams;
  const limitRaw = Number(sp.get("limit") ?? 50);
  const offsetRaw = Number(sp.get("offset") ?? 0);
  const { items, total } = await listListMembers(params.id, {
    limit: Math.min(50, Math.max(1, isFinite(limitRaw) ? limitRaw : 50)),
    offset: Math.max(0, isFinite(offsetRaw) ? offsetRaw : 0),
  });
  return NextResponse.json(
    { items, total },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  const blocked = await gate(user);
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const members: Array<{ kind: string; id: string }> = [];
  const pushMember = (kindRaw: unknown, idRaw: unknown) => {
    const kind = normalizeEntityKind(kindRaw);
    const id = typeof idRaw === "string" ? idRaw.trim() : "";
    if (kind && id) members.push({ kind, id });
  };
  if (Array.isArray(body.members)) {
    for (const m of body.members) {
      if (!m || typeof m !== "object") continue;
      const rec = m as Record<string, unknown>;
      pushMember(rec.kind ?? rec.entityKind ?? rec.entity_kind, rec.id ?? rec.entityId ?? rec.entity_id);
    }
  }
  const bulkKind = body.kind ?? body.entityKind ?? body.entity_kind;
  const bulkIds = Array.isArray(body.ids)
    ? body.ids
    : Array.isArray(body.entityIds)
      ? body.entityIds
      : [];
  for (const id of bulkIds) pushMember(bulkKind, id);
  if (!members.length) {
    return NextResponse.json(
      { error: "members (non-empty) are required" },
      { status: 400 }
    );
  }
  try {
    // crm.addListMembers is per-kind; the route accepts mixed-kind
    // member lists, so group by kind and sum the inserts.
    let added = 0;
    for (const k of ["person", "organization"] as const) {
      const idsForKind = members.filter((m) => m.kind === k).map((m) => m.id);
      if (!idsForKind.length) continue;
      const r = await addListMembers(params.id, k, idsForKind);
      added += r.added;
    }
    return NextResponse.json({ ok: true, added }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
