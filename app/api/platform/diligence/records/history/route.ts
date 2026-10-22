import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/diligence/http";
import { listSnapshots } from "@/lib/diligence/records";

/**
 * GET /api/platform/diligence/records/history?companyId=&checkType=
 * — snapshot history for a company (newest first, max 50), optionally
 * narrowed to one check type.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const companyId = req.nextUrl.searchParams.get("companyId") ?? "";
    if (!companyId) return ok({ error: "company_required" }, 400);
    const checkType = req.nextUrl.searchParams.get("checkType") ?? undefined;
    const snapshots = await listSnapshots(companyId, checkType);
    return ok({ snapshots });
  } catch (err) {
    return serviceError(err, "records-history");
  }
}
