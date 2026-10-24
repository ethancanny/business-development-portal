import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import {
  createMilestone,
  listMilestones,
} from "@/lib/valuecreation/service";

export async function GET(
  _req: NextRequest,
  { params }: { params: { initiativeId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const milestones = await listMilestones(params.initiativeId);
    return ok({ milestones });
  } catch (err) {
    return serviceError(err, "milestones-list");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { initiativeId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const milestone = await createMilestone(
      params.initiativeId,
      {
        title: typeof body.title === "string" ? body.title : undefined,
        dueDate:
          typeof body.dueDate === "string" || body.dueDate === null
            ? (body.dueDate as string | null)
            : undefined,
      },
      gate.user.name
    );
    return ok({ milestone });
  } catch (err) {
    return serviceError(err, "milestone-create");
  }
}
