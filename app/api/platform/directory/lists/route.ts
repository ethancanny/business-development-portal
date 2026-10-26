import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAccessContext } from "@/lib/platform/permissions";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDirectory } from "@/lib/directory/schema";
import { ensureCrm, listLists, createList } from "@/lib/directory/crm";

/** CRM Phase 1 — static lists across all Directory contact types. */

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

export async function GET() {
  const user = getSessionUser();
  const blocked = await gate(user);
  if (blocked) return blocked;
  const lists = await listLists();
  return NextResponse.json(
    { lists, items: lists },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  const blocked = await gate(user);
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  try {
    const list = await createList(name, user!.name || user!.email);
    return NextResponse.json({ list }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
