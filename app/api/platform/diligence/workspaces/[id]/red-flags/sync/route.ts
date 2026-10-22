import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/diligence/http";
import { syncRedFlagCandidates } from "@/lib/diligence/service";

/**
 * POST — pull the current financial analysis's anomalies (via the
 * finanalysis service) into the register as CANDIDATE red flags for
 * reviewer confirmation. Never auto-confirms.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const result = await syncRedFlagCandidates(params.id);
    return ok(result);
  } catch (err) {
    return serviceError(err, "red-flags-sync");
  }
}
