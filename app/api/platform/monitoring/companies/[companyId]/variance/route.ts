import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/monitoring/http";
import { getVariance } from "@/lib/monitoring/analytics";

/** GET four-way variance (actual / budget / VC target /
 * underwriting) for ?periodEnd=YYYY-MM-DD (defaults to the latest
 * KPI period). */
export async function GET(
  req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const periodEnd =
      req.nextUrl.searchParams.get("periodEnd") ?? undefined;
    return ok(await getVariance(params.companyId, periodEnd));
  } catch (err) {
    return serviceError(err, "variance-get");
  }
}
