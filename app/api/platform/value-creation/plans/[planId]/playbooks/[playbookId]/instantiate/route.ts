import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import { instantiatePlaybook } from "@/lib/valuecreation/service";

/** POST — create one initiative per playbook step in this plan. */
export async function POST(
  req: NextRequest,
  { params }: { params: { planId: string; playbookId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const initiatives = await instantiatePlaybook(
      params.planId,
      params.playbookId,
      {
        ownerName: typeof body.ownerName === "string" ? body.ownerName : undefined,
        startDate:
          typeof body.startDate === "string" || body.startDate === null
            ? (body.startDate as string | null)
            : undefined,
      },
      gate.user.name
    );
    return ok({ initiatives }, 201);
  } catch (err) {
    return serviceError(err, "playbook-instantiate");
  }
}
