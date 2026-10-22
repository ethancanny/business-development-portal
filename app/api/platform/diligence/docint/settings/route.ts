import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import { getSettings, setEnabled } from "@/lib/docint/service";

/**
 * GET  ?dealId= — per-deal document intelligence setting
 *      (defaults to enabled when no row exists).
 * PUT  { dealId, enabled } — set it (actor = signed-in user).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const dealId = req.nextUrl.searchParams.get("dealId") ?? "";
    if (!dealId) return ok({ error: "deal_id_required" }, 400);
    const settings = await getSettings(dealId);
    return ok({ settings });
  } catch (err) {
    return serviceError(err, "docint-settings-get");
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const dealId = typeof body.dealId === "string" ? body.dealId : "";
    if (!dealId) return ok({ error: "deal_id_required" }, 400);
    if (typeof body.enabled !== "boolean") {
      return ok({ error: "enabled_required" }, 400);
    }
    const settings = await setEnabled(dealId, body.enabled, gate.user.name);
    return ok({ settings });
  } catch (err) {
    return serviceError(err, "docint-settings-put");
  }
}
