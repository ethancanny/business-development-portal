import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import { convertFinding } from "@/lib/valuecreation/service";

/** POST converts one diligence finding into a linked initiative. */
export async function POST(
  req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const initiative = await convertFinding(
      params.planId,
      {
        workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : "",
        findingId: typeof body.findingId === "string" ? body.findingId : "",
        ownerName: typeof body.ownerName === "string" ? body.ownerName : undefined,
        dueDate:
          typeof body.dueDate === "string" || body.dueDate === null
            ? (body.dueDate as string | null)
            : undefined,
      },
      gate.user.name
    );
    return ok({ initiative });
  } catch (err) {
    return serviceError(err, "convert-finding");
  }
}
