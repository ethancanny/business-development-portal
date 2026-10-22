import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import { generateMemo, getCurrentMemo } from "@/lib/diligence/memo";

/**
 * IC memo for a deal.
 * GET  /api/platform/diligence/memo?dealId= — current memo + stale flag
 *      (stale = source records moved since it was generated).
 * POST /api/platform/diligence/memo { workspaceId } — assemble a new
 *      memo version from live records and make it current.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const dealId = req.nextUrl.searchParams.get("dealId") ?? "";
    if (!dealId) return ok({ error: "deal_id_required" }, 400);
    const { memo, stale } = await getCurrentMemo(dealId);
    return ok({ memo, stale });
  } catch (err) {
    return serviceError(err, "memo-get");
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
    const memo = await generateMemo(workspaceId, gate.user.name);
    return ok({ memo }, 201);
  } catch (err) {
    return serviceError(err, "memo-generate");
  }
}
