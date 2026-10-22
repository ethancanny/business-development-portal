import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import {
  deletePlan,
  getPlan,
  getPlanSummary,
  listInitiatives,
  updatePlan,
} from "@/lib/valuecreation/service";

/** GET bundle {plan, summary, initiatives}. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const plan = await getPlan(params.planId);
    if (!plan) return ok({ error: "plan_not_found" }, 404);
    const [summary, initiatives] = await Promise.all([
      getPlanSummary(params.planId),
      listInitiatives(params.planId),
    ]);
    return ok({ plan, summary, initiatives });
  } catch (err) {
    return serviceError(err, "plan-bundle");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const plan = await updatePlan(
      params.planId,
      {
        name: typeof body.name === "string" ? body.name : undefined,
        planStartDate:
          typeof body.planStartDate === "string" || body.planStartDate === null
            ? (body.planStartDate as string | null)
            : undefined,
        status: typeof body.status === "string" ? body.status : undefined,
        thesis: typeof body.thesis === "string" ? body.thesis : undefined,
        incentiveNotes:
          typeof body.incentiveNotes === "string" ? body.incentiveNotes : undefined,
      },
      gate.user.name
    );
    return ok({ plan });
  } catch (err) {
    return serviceError(err, "plan-update");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deletePlan(params.planId, gate.user.name);
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "plan-delete");
  }
}
