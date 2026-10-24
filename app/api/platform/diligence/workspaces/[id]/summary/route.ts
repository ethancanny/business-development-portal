import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/diligence/http";
import { getWorkspaceSummary } from "@/lib/diligence/service";

/**
 * GET — workspace summary for the redesigned diligence workspace:
 * header facts, clickable-tile counts, workstream readiness,
 * needs-attention lists, key dates, data room completeness, the QoE
 * EBITDA bridge, recent activity, and the deal team. Aggregate reads
 * only — the full bundle stays available at the parent route for the
 * surfaces that still consume it.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const summary = await getWorkspaceSummary(params.id);
    return ok(summary);
  } catch (err) {
    return serviceError(err, "workspace-summary");
  }
}
