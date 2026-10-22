import { NextRequest, NextResponse } from "next/server";
import { authed, companyGate, ok, serviceError } from "@/lib/monitoring/http";
import { evaluatePeriodDue, getPeriod } from "@/lib/monitoring/service";

/** POST run the period's due check now (ops/test entry point for the
 * 'monitoring_period_due' job handler). */
export async function POST(
  _req: NextRequest,
  { params }: { params: { periodId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const period = await getPeriod(params.periodId);
    if (period) {
      const forbidden = companyGate(gate.ctx, period.companyId);
      if (forbidden) return forbidden;
    }
    const result = await evaluatePeriodDue(params.periodId);
    return ok(result);
  } catch (err) {
    return serviceError(err, "period-check-due");
  }
}
