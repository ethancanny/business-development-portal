import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  ok,
  readBody,
  serviceError,
  sStr,
  sNum,
} from "@/lib/monitoring/http";
import { upsertVcRealized } from "@/lib/monitoring/analytics";

/** PUT upsert realized VC impact for one initiative + period.
 * Body: { initiativeId, periodEnd, realizedImpact, notes }. */
export async function PUT(
  req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const impact = sNum(body.realizedImpact);
    const realized = await upsertVcRealized(
      params.companyId,
      sStr(body.initiativeId) ?? sStr(body.initiative_id) ?? "",
      sStr(body.periodEnd) ?? sStr(body.period_end) ?? "",
      typeof impact === "number" ? impact : NaN,
      sStr(body.notes) ?? "",
      gate.user.name || gate.user.email
    );
    return ok({ realized });
  } catch (err) {
    return serviceError(err, "vc-realized-put");
  }
}
