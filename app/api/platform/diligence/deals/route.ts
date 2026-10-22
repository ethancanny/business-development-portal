import { NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/diligence/http";
import { listDealWorkspaces } from "@/lib/diligence/service";

/** GET /api/platform/diligence/deals — index: deals + workspaces. */
export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const items = await listDealWorkspaces();
    return ok({ items });
  } catch (err) {
    return serviceError(err, "deals-list");
  }
}
