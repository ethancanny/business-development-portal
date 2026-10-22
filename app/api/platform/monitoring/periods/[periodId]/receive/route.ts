import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/monitoring/http";
import {
  getPeriod,
  MonitoringError,
  receiveReport,
} from "@/lib/monitoring/service";

/**
 * POST receive a reporting package for a period: extracts + posts the
 * document's statement sets through the financials service and marks
 * the period received. Body: { documentId } — companyId is taken
 * from the period itself, never trusted from the client.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { periodId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const period = await getPeriod(params.periodId);
    if (!period) throw new MonitoringError("period_not_found");
    const forbidden = companyGate(gate.ctx, period.companyId);
    if (forbidden) return forbidden;
    const body = await readBody(req);
    const result = await receiveReport(
      period.companyId,
      params.periodId,
      { documentId: sStr(body.documentId) ?? "" },
      gate.user.name || gate.user.email
    );
    return ok(result);
  } catch (err) {
    return serviceError(err, "period-receive");
  }
}
