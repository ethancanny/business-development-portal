import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/valuecreation/http";
import { requirePlan } from "@/lib/valuecreation/service";
import { listAsIsCandidates } from "@/lib/valuecreation/bpmn";

/**
 * GET — diligence as-is diagrams for the plan's company, flattened to
 * linkable candidates for to-be maps.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const plan = await requirePlan(params.planId);
    const candidates = await listAsIsCandidates(plan.companyId);
    return ok({ candidates });
  } catch (err) {
    return serviceError(err, "asis-candidates");
  }
}
