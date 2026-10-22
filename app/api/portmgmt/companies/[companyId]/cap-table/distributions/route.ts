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
import {
  listDistributions,
  recordDistribution,
} from "@/lib/portmgmt/service";

export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  try {
    return ok({ distributions: await listDistributions(params.companyId) });
  } catch (err) {
    return serviceError(err, "distributions-get");
  }
}

/** POST record a distribution. Body: { holderId?, personId?, amount,
 * paidOn?, notes? } — mirrored into Investors & Capital when the
 * company has a deal and a personId (see service). */
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
    const amount = sNum(body.amount);
    const distribution = await recordDistribution(
      params.companyId,
      {
        holderId: sStr(body.holderId) ?? sStr(body.holder_id) ?? null,
        personId: sStr(body.personId) ?? sStr(body.person_id) ?? null,
        amount: typeof amount === "number" ? amount : NaN,
        paidOn: sDate(body.paidOn) ?? sDate(body.paid_on),
        notes: sStr(body.notes),
      },
      actor
    );
    return ok({ distribution }, 201);
  } catch (err) {
    return serviceError(err, "distributions-post");
  }
}
