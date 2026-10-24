import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import {
  deleteMilestone,
  updateMilestone,
} from "@/lib/valuecreation/service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { initiativeId: string; milestoneId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const milestone = await updateMilestone(
      params.milestoneId,
      {
        title: typeof body.title === "string" ? body.title : undefined,
        dueDate:
          typeof body.dueDate === "string" || body.dueDate === null
            ? (body.dueDate as string | null)
            : undefined,
        done: typeof body.done === "boolean" ? body.done : undefined,
      },
      gate.user.name
    );
    return ok({ milestone });
  } catch (err) {
    return serviceError(err, "milestone-update");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { initiativeId: string; milestoneId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteMilestone(params.milestoneId, gate.user.name);
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "milestone-delete");
  }
}
