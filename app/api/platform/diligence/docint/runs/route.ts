import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/diligence/http";
import { listRuns } from "@/lib/docint/service";

/** GET ?dealId=&limit= — extraction runs for a deal, newest first. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const dealId = req.nextUrl.searchParams.get("dealId") ?? "";
    if (!dealId) return ok({ error: "deal_id_required" }, 400);
    const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? 25);
    const limit =
      isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 25;
    const runs = await listRuns(dealId, limit);
    return ok({ runs });
  } catch (err) {
    return serviceError(err, "docint-runs");
  }
}
