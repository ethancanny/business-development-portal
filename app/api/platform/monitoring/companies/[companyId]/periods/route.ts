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
import { createPeriod, listPeriods } from "@/lib/monitoring/service";

/** GET the company's reporting periods (newest period first). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const forbidden = companyGate(gate.ctx, params.companyId);
  if (forbidden) return forbidden;
  try {
    const items = await listPeriods(params.companyId);
    return ok({ items, total: items.length });
  } catch (err) {
    return serviceError(err, "periods-list");
  }
}

/** POST create a reporting period (schedules its due-check job). */
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
    const period = await createPeriod(
      params.companyId,
      {
        cadence: sStr(body.cadence),
        periodStart: sDate(body.periodStart),
        periodEnd: sDate(body.periodEnd),
        dueDate: sDate(body.dueDate),
        notes: sStr(body.notes),
        source: sStr(body.source),
      },
      gate.user.name || gate.user.email
    );
    return ok({ period }, 201);
  } catch (err) {
    return serviceError(err, "period-create");
  }
}
