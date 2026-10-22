import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
  sNum,
} from "@/lib/monitoring/http";
import { getKpis, upsertManualKpi } from "@/lib/monitoring/analytics";

/** GET all kpi_values for the company, grouped by period (latest
 * first), plus the standard key list. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const forbidden = companyGate(gate.ctx, params.companyId);
  if (forbidden) return forbidden;
  try {
    return ok(await getKpis(params.companyId));
  } catch (err) {
    return serviceError(err, "kpis-get");
  }
}

/** PUT upsert a manual KPI (headcount, customer_count, custom keys). */
export async function PUT(
  req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const forbidden = companyGate(gate.ctx, params.companyId);
  if (forbidden) return forbidden;
  try {
    const body = await readBody(req);
    const value = sNum(body.value);
    const kpi = await upsertManualKpi(
      params.companyId,
      {
        periodEnd: sStr(body.periodEnd) ?? sStr(body.period_end) ?? "",
        kpiKey: sStr(body.kpiKey) ?? sStr(body.kpi_key) ?? "",
        label: sStr(body.label),
        value: typeof value === "number" ? value : NaN,
        unit: sStr(body.unit),
      },
      gate.user.name || gate.user.email
    );
    return ok({ kpi });
  } catch (err) {
    return serviceError(err, "kpis-put");
  }
}
