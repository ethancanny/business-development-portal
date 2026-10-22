import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/capital/http";
import { getIcBundle } from "@/lib/capital/ic";

/**
 * IC bundle — scorecard, the current diligence IC memo (+ stale flag),
 * and the decision log (latest first, ≤50).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    return ok(await getIcBundle(params.dealId));
  } catch (err) {
    return serviceError(err, "ic-get");
  }
}
