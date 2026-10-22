import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import {
  createWorkspace,
  getWorkspaceByDeal,
} from "@/lib/diligence/service";

/**
 * POST /api/platform/diligence/workspaces { dealId } — create (or
 * return) the deal's diligence workspace, seeded.
 * GET  /api/platform/diligence/workspaces?dealId= — fetch by deal.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const dealId = typeof body.dealId === "string" ? body.dealId : "";
    if (!dealId) {
      return ok({ error: "deal_id_required" }, 400);
    }
    const result = await createWorkspace(dealId, gate.user.name);
    return ok(result, result.existed ? 200 : 201);
  } catch (err) {
    return serviceError(err, "workspace-create");
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const dealId = req.nextUrl.searchParams.get("dealId") ?? "";
    if (!dealId) return ok({ error: "deal_id_required" }, 400);
    const workspace = await getWorkspaceByDeal(dealId);
    if (!workspace) return ok({ error: "workspace_not_found" }, 404);
    return ok({ workspace });
  } catch (err) {
    return serviceError(err, "workspace-by-deal");
  }
}
