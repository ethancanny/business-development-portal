import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/monitoring/http";
import { computeCovenantTests } from "@/lib/monitoring/analytics";

/** POST compute covenant tests for { periodEnd } from the latest
 * posted financials at or before that date. Returns
 * { tests, skipped } — skipped covenants carry a not_computable
 * reason instead of a fabricated value. */
export async function POST(
  req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const forbidden = companyGate(gate.ctx, params.companyId);
  if (forbidden) return forbidden;
  try {
    const body = await readBody(req);
    const result = await computeCovenantTests(
      params.companyId,
      sStr(body.periodEnd) ?? sStr(body.period_end) ?? "",
      gate.user.name || gate.user.email
    );
    return ok(result);
  } catch (err) {
    return serviceError(err, "covenants-compute");
  }
}
