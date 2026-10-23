import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import {
  getTemplateById,
  softDeleteTemplate,
  updateTemplate,
} from "@/lib/docgen/templates";

/** One DocGen template: read (GET), edit (PATCH), soft-delete (DELETE). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const template = await getTemplateById(params.id);
  if (!template) {
    return NextResponse.json(
      { error: "template_not_found" },
      { status: 404 }
    );
  }
  return NextResponse.json({ template });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const template = await updateTemplate(
      params.id,
      {
        name: typeof body.name === "string" ? body.name : undefined,
        description:
          typeof body.description === "string" ? body.description : undefined,
        body: typeof body.body === "string" ? body.body : undefined,
      },
      user.name || user.email
    );
    if (!template) {
      return NextResponse.json(
        { error: "template_not_found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ template });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const ok = await softDeleteTemplate(params.id);
  if (!ok) {
    return NextResponse.json(
      { error: "template_not_found" },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
