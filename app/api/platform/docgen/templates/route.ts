import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import {
  createTemplate,
  listTemplates,
} from "@/lib/docgen/templates";

/** DocGen templates: list (GET) and create (POST). Bodies included —
 * the catalog is small and the template editor needs full text.
 * Contract generation (Oct 24, 2026): GET accepts ?scope=deal|
 * investor|general and ?status=draft|approved filters; rows carry
 * version / status / approved-by / scope / source format. */
export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const sp = req.nextUrl.searchParams;
  const templates = await listTemplates({
    scope: sp.get("scope") ?? undefined,
    status: sp.get("status") ?? undefined,
  });
  return NextResponse.json(
    { templates },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name : "";
  const tplBody = typeof body.body === "string" ? body.body : "";
  if (!name.trim() || !tplBody.trim()) {
    return NextResponse.json(
      { error: "name and body are required" },
      { status: 400 }
    );
  }
  try {
    const template = await createTemplate(
      {
        key: typeof body.key === "string" ? body.key : undefined,
        name,
        description:
          typeof body.description === "string" ? body.description : undefined,
        body: tplBody,
        scope: typeof body.scope === "string" ? body.scope : undefined,
      },
      user.name || user.email
    );
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "key_conflict") {
      return NextResponse.json(
        { error: "key_conflict", detail: "A template with that key already exists." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
