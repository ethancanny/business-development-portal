import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import {
  approveTemplate,
  getTemplateById,
  softDeleteTemplate,
  unapproveTemplate,
  updateTemplate,
} from "@/lib/docgen/templates";

/** One DocGen template: read (GET), edit (PATCH), soft-delete (DELETE).
 * Contract generation (Oct 24, 2026): PATCH also accepts
 * { action: "approve", approvedBy, note } and { action: "unapprove" }.
 * Content edits bump the version and return the template to draft. */
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
    if (body.action === "approve") {
      const template = await approveTemplate(params.id, {
        approvedBy:
          typeof body.approvedBy === "string"
            ? body.approvedBy
            : user.name || user.email,
        note: typeof body.note === "string" ? body.note : undefined,
      });
      if (!template) {
        return NextResponse.json(
          { error: "template_not_found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ template });
    }
    if (body.action === "unapprove") {
      const template = await unapproveTemplate(params.id);
      if (!template) {
        return NextResponse.json(
          { error: "template_not_found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ template });
    }
    const template = await updateTemplate(
      params.id,
      {
        name: typeof body.name === "string" ? body.name : undefined,
        description:
          typeof body.description === "string" ? body.description : undefined,
        body: typeof body.body === "string" ? body.body : undefined,
        scope: typeof body.scope === "string" ? body.scope : undefined,
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
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "approved_by_required" ? 400 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!getSessionUser()) {
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
