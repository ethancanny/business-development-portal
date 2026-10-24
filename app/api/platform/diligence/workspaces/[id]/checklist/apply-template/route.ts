import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import { applyTemplatePack } from "@/lib/diligence/service";

/**
 * POST — apply a checklist template pack (base / ad / addon /
 * early_stage) to this workspace. Inserts only titles not already
 * present; existing items are never modified by a template.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const pack = typeof body.pack === "string" ? body.pack : "";
    const result = await applyTemplatePack(params.id, pack, gate.user.name);
    return ok(result);
  } catch (err) {
    return serviceError(err, "checklist-apply-template");
  }
}
