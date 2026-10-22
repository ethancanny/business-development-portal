import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/portmgmt/http";
import { submitKpis } from "@/lib/portmgmt/submissions";

/** POST submit KPI values for the period.
 * Body: { headcount?, customerCount?, custom?: [{ key, value, periodEnd }] } */
export async function POST(
  req: NextRequest,
  { params }: { params: { companyId: string; periodId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  const actor = gate.user.name || gate.user.email;
  try {
    const body = await readBody(req);
    // Custom KPIs: array form [{key, value, periodEnd?}] (API
    // contract) or object form {key: number} (portal KPI grid).
    const custom = Array.isArray(body.custom)
      ? body.custom.map((raw) => {
          const rec =
            raw && typeof raw === "object"
              ? (raw as Record<string, unknown>)
              : {};
          return {
            key: sStr(rec.key) ?? sStr(rec.kpiKey) ?? "",
            value: typeof rec.value === "number" ? rec.value : NaN,
            periodEnd: sStr(rec.periodEnd) ?? sStr(rec.period_end) ?? "",
          };
        })
      : body.custom && typeof body.custom === "object"
        ? Object.entries(body.custom as Record<string, unknown>).map(
            ([key, v]) => ({
              key,
              value: typeof v === "number" ? v : NaN,
              periodEnd: "",
            })
          )
        : undefined;
    const result = await submitKpis(
      params.companyId,
      params.periodId,
      {
        headcount:
          typeof body.headcount === "number" ? body.headcount : undefined,
        customerCount:
          typeof body.customerCount === "number"
            ? body.customerCount
            : undefined,
        custom,
      },
      actor
    );
    return ok(result);
  } catch (err) {
    return serviceError(err, "period-kpis");
  }
}
