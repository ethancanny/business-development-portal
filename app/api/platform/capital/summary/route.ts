import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/capital/http";
import { getCapitalPageSummary } from "@/lib/capital/service";

/** GET the Investors & Capital page summary across open raises
 * (stored deal_summary rollups; ?type=<typeKey> filters the totals). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const type = req.nextUrl.searchParams.get("type") ?? undefined;
    const summary = await getCapitalPageSummary(type || undefined);
    return ok(summary);
  } catch (err) {
    return serviceError(err, "page-summary");
  }
}
