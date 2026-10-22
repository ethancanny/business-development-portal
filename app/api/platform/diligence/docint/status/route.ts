import { NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/diligence/http";
import { getDocintStatus } from "@/lib/docint/provider";

/** GET — document intelligence provider status (active provider,
 * Azure configuration + no-training detail, local provider detail). */
export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const status = await getDocintStatus();
    return ok({
      ...status,
      note: `Active provider: ${status.activeProvider}`,
    });
  } catch (err) {
    return serviceError(err, "docint-status");
  }
}
