import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/monitoring/http";
import { upsertVarianceNote } from "@/lib/monitoring/analytics";

/** PUT upsert the variance commentary for one metric + period.
 * Body: { periodEnd, metricKey, commentary }. */
export async function PUT(
  req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const note = await upsertVarianceNote(
      params.companyId,
      sStr(body.periodEnd) ?? sStr(body.period_end) ?? "",
      sStr(body.metricKey) ?? sStr(body.metric_key) ?? "",
      sStr(body.commentary) ?? "",
      gate.user.name || gate.user.email
    );
    return ok({ note });
  } catch (err) {
    return serviceError(err, "variance-note-put");
  }
}
