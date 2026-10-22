import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
  sStrArr,
} from "@/lib/portmgmt/http";
import { getExitPlan, upsertExitPlan } from "@/lib/portmgmt/service";

/** GET exit plan: VC exit readiness + the portmgmt plan row + broker
 * contacts from the Directory. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  try {
    return ok(await getExitPlan(params.companyId));
  } catch (err) {
    return serviceError(err, "exit-plan-get");
  }
}

/** PUT upsert the exit plan. Body: { likelyBuyerTypes?, targetTiming?, notes? } */
export async function PUT(
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
    const plan = await upsertExitPlan(
      params.companyId,
      {
        likelyBuyerTypes:
          sStrArr(body.likelyBuyerTypes) ?? sStrArr(body.likely_buyer_types),
        targetTiming: sStr(body.targetTiming) ?? sStr(body.target_timing),
        notes: sStr(body.notes),
      },
      actor
    );
    return ok({ plan });
  } catch (err) {
    return serviceError(err, "exit-plan-put");
  }
}
