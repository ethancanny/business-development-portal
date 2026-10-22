import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
  sDate,
} from "@/lib/monitoring/http";
import {
  deletePeriod,
  getPeriod,
  MonitoringError,
  updatePeriod,
} from "@/lib/monitoring/service";

/** PATCH a reporting period (dates / cadence / status / notes). A
 * due-date change supersedes the scheduled due-check job. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { periodId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const existing = await getPeriod(params.periodId);
    if (!existing) throw new MonitoringError("period_not_found");
    const forbidden = companyGate(gate.ctx, existing.companyId);
    if (forbidden) return forbidden;
    const body = await readBody(req);
    const period = await updatePeriod(
      params.periodId,
      {
        cadence: sStr(body.cadence),
        periodStart: sDate(body.periodStart),
        periodEnd: sDate(body.periodEnd),
        dueDate: sDate(body.dueDate),
        status: sStr(body.status),
        notes: sStr(body.notes),
      },
      gate.user.name || gate.user.email
    );
    return ok({ period });
  } catch (err) {
    return serviceError(err, "period-update");
  }
}

/** DELETE soft-deletes a reporting period (and cancels its due job). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { periodId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const existing = await getPeriod(params.periodId);
    if (existing) {
      const forbidden = companyGate(gate.ctx, existing.companyId);
      if (forbidden) return forbidden;
    }
    const deleted = await deletePeriod(
      params.periodId,
      gate.user.name || gate.user.email
    );
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "period-delete");
  }
}
