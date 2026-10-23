import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError, NO_STORE } from "@/lib/comms/http";
import {
  deleteTemplate,
  getTemplate,
  updateTemplate,
} from "@/lib/comms/service";

/** Same normalization as templates/route.ts (duplicated — route
 *  files may not export shared helpers). */
function templateInputFrom(body: Record<string, unknown>) {
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : undefined;
  return {
    name: typeof body.name === "string" ? body.name : undefined,
    purpose: typeof body.purpose === "string" ? body.purpose : undefined,
    audience: typeof body.audience === "string" ? body.audience : undefined,
    subjectKinds: strArr(body.subjectKinds) ?? strArr(body.subject_kinds),
    blocks: Array.isArray(body.blocks) ? body.blocks : undefined,
    tone: typeof body.tone === "string" ? body.tone : undefined,
    disclaimers:
      strArr(body.disclaimers) ??
      (typeof body.disclaimers === "string"
        ? body.disclaimers
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined),
    routine: typeof body.routine === "boolean" ? body.routine : undefined,
  };
}

/** GET one template. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const template = await getTemplate(params.id);
    if (!template) {
      return NextResponse.json(
        { error: "template_not_found" },
        { status: 404, headers: NO_STORE }
      );
    }
    return ok({ template });
  } catch (err) {
    return serviceError(err, "template-detail");
  }
}

/** PUT update a template (service enforces routineAllowed). */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const template = await updateTemplate(
      params.id,
      templateInputFrom(body) as Parameters<typeof updateTemplate>[1],
      gate.user.name || gate.user.email
    );
    return ok({ template });
  } catch (err) {
    return serviceError(err, "template-update");
  }
}

/** DELETE (soft) a template. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    await deleteTemplate(params.id, gate.user.name || gate.user.email);
    return ok({ deleted: true });
  } catch (err) {
    return serviceError(err, "template-delete");
  }
}
