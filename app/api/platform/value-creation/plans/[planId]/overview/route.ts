import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/valuecreation/http";
import { getPlanOverview } from "@/lib/valuecreation/service";

/** GET the composed Overview payload (stored summaries + services). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const overview = await getPlanOverview(params.planId);
    return ok({ overview });
  } catch (err) {
    return serviceError(err, "plan-overview");
  }
}
