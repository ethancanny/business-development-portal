import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
  sNum,
  sDate,
} from "@/lib/monitoring/http";
import {
  listDebtTranches,
  createDebtTranche,
  type DebtTrancheInput,
} from "@/lib/monitoring/analytics";

function trancheInputFrom(
  body: Record<string, unknown>
): DebtTrancheInput {
  return {
    lender: sStr(body.lender),
    kind: sStr(body.kind),
    principal: sNum(body.principal),
    currentBalance: sNum(body.currentBalance),
    ratePct: sNum(body.ratePct),
    maturity: sDate(body.maturity),
    notes: sStr(body.notes),
  };
}

/** GET debt tranches with principal / balance totals. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const forbidden = companyGate(gate.ctx, params.companyId);
  if (forbidden) return forbidden;
  try {
    return ok(await listDebtTranches(params.companyId));
  } catch (err) {
    return serviceError(err, "debt-get");
  }
}

/** POST create a debt tranche. */
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
    const tranche = await createDebtTranche(
      params.companyId,
      trancheInputFrom(body),
      gate.user.name || gate.user.email
    );
    return ok({ tranche }, 201);
  } catch (err) {
    return serviceError(err, "debt-post");
  }
}
