import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAccessContext } from "@/lib/platform/permissions";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDirectory } from "@/lib/directory/schema";
import {
  ensureCrm,
  listInteractionTemplates,
  createInteractionTemplate,
} from "@/lib/directory/crm";

/**
 * CRM Phase 1 — Quick log templates. The service seeds
 * "Intro call" / "Broker coffee" on first list when empty.
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

export async function GET() {
  const user = getSessionUser();
  const blocked = await gate(user);
  if (blocked) return blocked;
  const templates = await listInteractionTemplates();
  return NextResponse.json(
    { templates, items: templates },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  const blocked = await gate(user);
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const type = typeof body.type === "string" ? body.type.trim() : "";
  if (!name || !type) {
    return NextResponse.json(
      { error: "name and type are required" },
      { status: 400 }
    );
  }
  try {
    const actor = user!.name || user!.email;
    const template = await createInteractionTemplate({
      name,
      type,
      summary: typeof body.summary === "string" ? body.summary : undefined,
      outcome: typeof body.outcome === "string" ? body.outcome : undefined,
      createdBy: actor,
      actor,
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
