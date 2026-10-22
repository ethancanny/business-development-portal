import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  internalGate,
  ok,
  serviceError,
} from "@/lib/portmgmt/http";
import { computeEarlyWarning } from "@/lib/portmgmt/service";

/** POST recompute one company's early-warning score (internal only). */
export async function POST(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = internalGate(gate.ctx);
  if (denied) return denied;
  try {
    return ok({ earlyWarning: await computeEarlyWarning(params.companyId) });
  } catch (err) {
    return serviceError(err, "early-warning-recompute");
  }
}
