import { NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/diligence/http";
import { getDocintStatus } from "@/lib/docint/provider";
import { getAzureUsageThisMonth } from "@/lib/docint/service";

/** GET — document intelligence provider status (routing policy,
 * Azure configuration + no-training detail, local provider detail,
 * and this month's Azure usage from the processing log). */
export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const status = await getDocintStatus();
    const azureUsageThisMonth = await getAzureUsageThisMonth().catch(
      () => ({ runs: 0, pages: 0 })
    );
    return ok({
      ...status,
      azureUsageThisMonth,
      note: `Active provider: ${status.activeProvider}`,
    });
  } catch (err) {
    return serviceError(err, "docint-status");
  }
}
