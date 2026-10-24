import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/valuecreation/http";
import { listFindingCandidates } from "@/lib/valuecreation/service";

/** GET diligence findings for the plan's company (via diligence service). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const candidates = await listFindingCandidates(params.planId);
    return ok({ candidates });
  } catch (err) {
    return serviceError(err, "finding-candidates");
  }
}
