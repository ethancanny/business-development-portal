import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import { deriveTargets } from "@/lib/valuecreation/service";

/** POST {growthPct?, scenarioId?} — derive next-year targets from posted financials + initiative impact. */
export async function POST(
  req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const targets = await deriveTargets(
      params.planId,
      {
        growthPct:
          typeof body.growthPct === "number" ? body.growthPct : undefined,
        scenarioId:
          typeof body.scenarioId === "string" ? body.scenarioId : undefined,
      },
      gate.user.name
    );
    return ok({ targets }, 201);
  } catch (err) {
    return serviceError(err, "targets-derive");
  }
}
