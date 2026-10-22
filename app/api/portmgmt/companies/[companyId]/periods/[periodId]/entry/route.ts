import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/portmgmt/http";
import { submitEntry } from "@/lib/portmgmt/submissions";

/** POST submit manually entered statement lines for the period.
 * Body: { lines: [{ lineKey, value }], periodEnd, basis? } */
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
    const lines = Array.isArray(body.lines)
      ? body.lines.map((raw) => {
          const rec =
            raw && typeof raw === "object"
              ? (raw as Record<string, unknown>)
              : {};
          return {
            lineKey: sStr(rec.lineKey) ?? sStr(rec.line_key) ?? "",
            // API contract uses `value`; the portal entry grid sends
            // `amount` — accept both.
            value:
              typeof rec.value === "number"
                ? rec.value
                : typeof rec.amount === "number"
                  ? rec.amount
                  : NaN,
          };
        })
      : [];
    const result = await submitEntry(
      params.companyId,
      params.periodId,
      {
        lines,
        periodEnd: sStr(body.periodEnd) ?? sStr(body.period_end) ?? "",
        basis: sStr(body.basis),
      },
      actor
    );
    return ok(result);
  } catch (err) {
    return serviceError(err, "period-entry");
  }
}
