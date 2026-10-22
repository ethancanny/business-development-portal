import { NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/portmgmt/http";
import { getEarlyWarningOverview } from "@/lib/portmgmt/service";

/** GET the early-warning overview: stored scores for every live
 * portfolio company the caller can access, worst first. */
export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const rows = await getEarlyWarningOverview();
    const visible =
      gate.ctx.companyIds === null
        ? rows
        : rows.filter((r) => gate.ctx.companyIds?.includes(r.companyId));
    return ok({ earlyWarning: visible });
  } catch (err) {
    return serviceError(err, "early-warning-overview");
  }
}
