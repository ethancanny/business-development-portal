import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/capital/http";
import { listMatchingForRaise } from "@/lib/capital/service";

/** GET ranked investor matches for this deal's raise, with
 * plain-English per-criterion reasons and the weights used. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const matching = await listMatchingForRaise(params.dealId);
    return ok(matching);
  } catch (err) {
    return serviceError(err, "deal-matching");
  }
}
