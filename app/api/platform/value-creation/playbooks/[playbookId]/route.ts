import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import {
  deletePlaybook,
  updatePlaybook,
  type PlaybookStep,
} from "@/lib/valuecreation/service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { playbookId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const playbook = await updatePlaybook(
      params.playbookId,
      {
        name: typeof body.name === "string" ? body.name : undefined,
        category: typeof body.category === "string" ? body.category : undefined,
        description:
          typeof body.description === "string" ? body.description : undefined,
        steps: Array.isArray(body.steps)
          ? (body.steps as PlaybookStep[])
          : undefined,
      },
      gate.user.name
    );
    return ok({ playbook });
  } catch (err) {
    return serviceError(err, "playbook-update");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { playbookId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deletePlaybook(params.playbookId, gate.user.name);
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "playbook-delete");
  }
}
