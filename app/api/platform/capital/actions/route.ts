import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/capital/http";
import { getActionItems } from "@/lib/capital/service";
import { datasetVersionHeader } from "@/lib/platform/versions";

/** GET the Action Center list across open raises
 * (?type=<typeKey> filters to one investment type). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const type = req.nextUrl.searchParams.get("type") ?? undefined;
    const result = await getActionItems(type || undefined);
    const res = ok(result);
    const hdr = await datasetVersionHeader("capital");
    if (hdr["X-Dataset-Version"]) res.headers.set("X-Dataset-Version", hdr["X-Dataset-Version"]);
    return res;
  } catch (err) {
    return serviceError(err, "action-items");
  }
}
