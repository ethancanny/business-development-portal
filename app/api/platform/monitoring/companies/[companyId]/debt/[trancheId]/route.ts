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
  updateDebtTranche,
  deleteDebtTranche,
  type DebtTrancheInput,
} from "@/lib/monitoring/analytics";

function tranchePatchFrom(
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

/** PATCH a debt tranche (partial). */
export async function PATCH(
  req: NextRequest,
  {
    params,
  }: { params: { companyId: string; trancheId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const forbidden = companyGate(gate.ctx, params.companyId);
  if (forbidden) return forbidden;
  try {
    const body = await readBody(req);
    const tranche = await updateDebtTranche(
      params.companyId,
      params.trancheId,
      tranchePatchFrom(body),
      gate.user.name || gate.user.email
    );
    return ok({ tranche });
  } catch (err) {
    return serviceError(err, "debt-patch");
  }
}

/** DELETE soft-deletes a debt tranche. */
export async function DELETE(
  _req: NextRequest,
  {
    params,
  }: { params: { companyId: string; trancheId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const forbidden = companyGate(gate.ctx, params.companyId);
  if (forbidden) return forbidden;
  try {
    const deleted = await deleteDebtTranche(
      params.companyId,
      params.trancheId,
      gate.user.name || gate.user.email
    );
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "debt-delete");
  }
}
