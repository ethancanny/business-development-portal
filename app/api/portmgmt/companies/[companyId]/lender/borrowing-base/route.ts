import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sNum,
} from "@/lib/portmgmt/http";
import { computeBorrowingBase } from "@/lib/portmgmt/service";

/** POST compute a borrowing-base snapshot. Body: { advanceRate? } */
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
    const advanceRate = sNum(body.advanceRate);
    const snapshot = await computeBorrowingBase(
      params.companyId,
      { advanceRate: advanceRate === undefined || advanceRate === null ? undefined : advanceRate },
      actor
    );
    return ok({ snapshot }, 201);
  } catch (err) {
    return serviceError(err, "lender-borrowing-base");
  }
}
