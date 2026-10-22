import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/monitoring/http";
import { evaluatePeriodDue } from "@/lib/monitoring/service";

/** POST run the period's due check now (ops/test entry point for the
 * 'monitoring_period_due' job handler). */
export async function POST(
  _req: NextRequest,
  { params }: { params: { periodId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const result = await evaluatePeriodDue(params.periodId);
    return ok(result);
  } catch (err) {
    return serviceError(err, "period-check-due");
  }
}
