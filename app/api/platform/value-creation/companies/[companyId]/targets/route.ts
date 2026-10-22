import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/valuecreation/http";
import { getValueCreationTargets } from "@/lib/valuecreation/service";

/**
 * GET — the Phase 8 surface: a company's value-creation targets.
 * Optional ?periodEnd=YYYY-MM-DD filter.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const periodEnd = req.nextUrl.searchParams.get("periodEnd") ?? undefined;
    const result = await getValueCreationTargets(params.companyId, periodEnd);
    return ok(result);
  } catch (err) {
    return serviceError(err, "company-targets");
  }
}
