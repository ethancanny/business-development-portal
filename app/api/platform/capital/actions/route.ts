import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/capital/http";
import { getActionItems } from "@/lib/capital/service";

/** GET the Action Center list across open raises
 * (?type=<typeKey> filters to one investment type). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const type = req.nextUrl.searchParams.get("type") ?? undefined;
    const result = await getActionItems(type || undefined);
    return ok(result);
  } catch (err) {
    return serviceError(err, "action-items");
  }
}
