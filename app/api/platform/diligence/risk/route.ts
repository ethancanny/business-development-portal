import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import { computeRisk, getRisk } from "@/lib/diligence/risk";

/**
 * Deal risk score.
 * GET  /api/platform/diligence/risk?dealId= — current score + history
 *      (score/band/trigger/changes only, last 20).
 * POST /api/platform/diligence/risk { workspaceId } — recompute now
 *      (trigger 'manual') and append a new score row.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const dealId = req.nextUrl.searchParams.get("dealId") ?? "";
    if (!dealId) return ok({ error: "deal_id_required" }, 400);
    const result = await getRisk(dealId);
    return ok(result);
  } catch (err) {
    return serviceError(err, "risk-get");
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const workspaceId =
      typeof body.workspaceId === "string" ? body.workspaceId : "";
    if (!workspaceId) return ok({ error: "workspace_required" }, 400);
    const risk = await computeRisk(workspaceId, gate.user.name, "manual");
    return ok({ risk }, 201);
  } catch (err) {
    return serviceError(err, "risk-compute");
  }
}
