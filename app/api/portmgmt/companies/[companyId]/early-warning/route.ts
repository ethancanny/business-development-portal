import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  serviceError,
} from "@/lib/portmgmt/http";
import { getEarlyWarning } from "@/lib/portmgmt/service";

/** GET one company's early-warning row (stored; computed on miss). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  try {
    return ok({ earlyWarning: await getEarlyWarning(params.companyId) });
  } catch (err) {
    return serviceError(err, "early-warning-get");
  }
}
