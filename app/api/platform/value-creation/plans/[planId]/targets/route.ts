import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import { listTargets, upsertTarget } from "@/lib/valuecreation/service";

export async function GET(
  _req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const targets = await listTargets(params.planId);
    return ok({ targets });
  } catch (err) {
    return serviceError(err, "targets-list");
  }
}

/** POST — upsert a target (unique per plan + period_end + metric). */
export async function POST(
  req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const target = await upsertTarget(
      params.planId,
      {
        periodLabel: typeof body.periodLabel === "string" ? body.periodLabel : "",
        periodEnd: typeof body.periodEnd === "string" ? body.periodEnd : "",
        metric: typeof body.metric === "string" ? body.metric : "",
        targetValue:
          typeof body.targetValue === "number" ? body.targetValue : NaN,
        source: typeof body.source === "string" ? body.source : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
      },
      gate.user.name
    );
    return ok({ target }, 201);
  } catch (err) {
    return serviceError(err, "target-upsert");
  }
}
