import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import {
  runAutomatedChecks,
  runMonthlyRefresh,
} from "@/lib/diligence/records";

/**
 * POST /api/platform/diligence/records/refresh { companyId? }
 * — with a companyId, run the automated (ADHS-derived) license check
 * for that one company; without one, run the monthly refresh across
 * every company with a diligence workspace or prior checks.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const companyId =
      typeof body.companyId === "string" ? body.companyId : "";
    if (companyId) {
      const result = await runAutomatedChecks(companyId, gate.user.name);
      return ok(result, result.ran ? 201 : 200);
    }
    const result = await runMonthlyRefresh(gate.user.name);
    return ok(result);
  } catch (err) {
    return serviceError(err, "records-refresh");
  }
}
