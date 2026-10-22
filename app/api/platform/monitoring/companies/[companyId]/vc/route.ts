import { NextRequest, NextResponse } from "next/server";
import { authed, companyGate, ok, serviceError } from "@/lib/monitoring/http";
import { getVcTracking } from "@/lib/monitoring/analytics";

/** GET value-creation tracking: plan + initiatives (raw planned
 * impact + confidence, realized to date) + targets. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const forbidden = companyGate(gate.ctx, params.companyId);
  if (forbidden) return forbidden;
  try {
    return ok(await getVcTracking(params.companyId));
  } catch (err) {
    return serviceError(err, "vc-get");
  }
}
