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
} from "@/lib/portmgmt/http";
import { listValuations, createValuation } from "@/lib/portmgmt/service";

export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  try {
    return ok({ valuations: await listValuations(params.companyId) });
  } catch (err) {
    return serviceError(err, "valuations-get");
  }
}

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
    const valuation = await createValuation(
      params.companyId,
      {
        valuedAsOf: sDate(body.valuedAsOf) ?? sDate(body.valued_as_of),
        value: sNum(body.value),
        method: sStr(body.method),
        notes: sStr(body.notes),
      },
      actor
    );
    return ok({ valuation }, 201);
  } catch (err) {
    return serviceError(err, "valuations-post");
  }
}
