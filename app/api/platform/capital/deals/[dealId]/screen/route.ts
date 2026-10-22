import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/capital/http";
import { getDealScreenSummary } from "@/lib/capital/screen";

/**
 * Deal screen summary — read-only assembly of the approved
 * finanalysis payload (margin bridge, stored deal screen, working
 * capital peg) plus the global valuation params. Nothing is
 * recomputed here.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    return ok(await getDealScreenSummary(params.dealId));
  } catch (err) {
    return serviceError(err, "screen-get");
  }
}
