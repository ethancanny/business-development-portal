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
import {
  listBudgetVersions,
  createBudgetVersion,
} from "@/lib/monitoring/analytics";

/** GET budget versions for the company (?fiscalYear=YYYY optional). */
export async function GET(
  req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  try {
    const raw = req.nextUrl.searchParams.get("fiscalYear");
    const year = raw !== null && raw !== "" ? Number(raw) : undefined;
    const versions = await listBudgetVersions(
      params.companyId,
      year !== undefined && isFinite(year) ? year : undefined
    );
    return ok({ companyId: params.companyId, versions });
  } catch (err) {
    return serviceError(err, "budget-versions-get");
  }
}

/** POST create a new draft budget version.
 * Body: { fiscalYear, kind?: 'annual'|'reforecast', notes? } */
export async function POST(
  req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  const actor = gate.user.name || gate.user.email;
  try {
    const body = await readBody(req);
    const fiscalYear = sNum(body.fiscalYear);
    const version = await createBudgetVersion(
      params.companyId,
      typeof fiscalYear === "number" ? fiscalYear : NaN,
      { kind: sStr(body.kind), notes: sStr(body.notes) },
      actor
    );
    return ok({ version }, 201);
  } catch (err) {
    return serviceError(err, "budget-versions-post");
  }
}
