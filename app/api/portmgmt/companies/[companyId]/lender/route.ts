import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  serviceError,
} from "@/lib/portmgmt/http";
import { getLenderState } from "@/lib/portmgmt/service";

/** GET lender state: latest certificate, latest borrowing base,
 * covenant definitions + latest tests (via monitoring analytics). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  try {
    return ok(await getLenderState(params.companyId));
  } catch (err) {
    return serviceError(err, "lender-get");
  }
}
