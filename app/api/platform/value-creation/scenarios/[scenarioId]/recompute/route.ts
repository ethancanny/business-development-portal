import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/valuecreation/http";
import { recomputeScenario } from "@/lib/valuecreation/scenarios";

/** POST — re-run the bridge over the plan's current initiatives. */
export async function POST(
  _req: NextRequest,
  { params }: { params: { scenarioId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const scenario = await recomputeScenario(params.scenarioId, gate.user.name);
    return ok({ scenario });
  } catch (err) {
    return serviceError(err, "scenario-recompute");
  }
}
