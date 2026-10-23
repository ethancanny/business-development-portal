import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/comms/http";
import { createTemplate, listTemplates } from "@/lib/comms/service";

/** Template create/update payload, normalized from the client body
 *  (camelCase preferred; snake_case accepted for robustness). */
function templateInputFrom(body: Record<string, unknown>) {
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : undefined;
  return {
    name: typeof body.name === "string" ? body.name : undefined,
    purpose: typeof body.purpose === "string" ? body.purpose : undefined,
    audience: typeof body.audience === "string" ? body.audience : undefined,
    subjectKinds:
      strArr(body.subjectKinds) ?? strArr(body.subject_kinds),
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

/** GET template list. */
export async function GET(_req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const result = (await listTemplates()) as unknown;
    const items = Array.isArray(result)
      ? result
      : ((result as { items?: unknown[] })?.items ?? []);
    return ok({ items });
  } catch (err) {
    return serviceError(err, "templates-list");
  }
}

/** POST create a template (service enforces routineAllowed). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const template = await createTemplate(
      templateInputFrom(body) as Parameters<typeof createTemplate>[0],
      gate.user.name || gate.user.email
    );
    return ok({ template });
  } catch (err) {
    return serviceError(err, "templates-create");
  }
}
