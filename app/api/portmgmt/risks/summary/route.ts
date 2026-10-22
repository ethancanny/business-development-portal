import { NextResponse } from "next/server";
import {
  authed,
  internalGate,
  ok,
  serviceError,
} from "@/lib/portmgmt/http";
import { getRiskSummary } from "@/lib/portmgmt/service";

/** GET the stored portfolio risk summary (internal only) — reads the
 * portmgmt.risk_summary read model refreshed by every risk mutation. */
export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = internalGate(gate.ctx);
  if (denied) return denied;
  try {
    return ok({ summary: await getRiskSummary() });
  } catch (err) {
    return serviceError(err, "risk-summary");
  }
}
