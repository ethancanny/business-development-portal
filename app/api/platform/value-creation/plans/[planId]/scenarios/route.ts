import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import {
  listScenarios,
  createScenario,
  type ScenarioAssumptions,
} from "@/lib/valuecreation/scenarios";

function assumptionsFrom(body: Record<string, unknown>): Partial<ScenarioAssumptions> | undefined {
  const raw = body.assumptions;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const rec = raw as Record<string, unknown>;
  const out: Partial<ScenarioAssumptions> = {};
  if (typeof rec.horizonMonths === "number") out.horizonMonths = rec.horizonMonths;
  if (typeof rec.revenueGrowthPct === "number") out.revenueGrowthPct = rec.revenueGrowthPct;
  if (typeof rec.realizationPct === "number") out.realizationPct = rec.realizationPct;
  return out;
}

/** GET — scenario list for the plan (metadata + stored totals). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const scenarios = await listScenarios(params.planId);
    return ok({ scenarios });
  } catch (err) {
    return serviceError(err, "scenarios-list");
  }
}

/** POST — create a scenario (base snapshotted from financials). */
export async function POST(
  req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const scenario = await createScenario(
      params.planId,
      {
        name: typeof body.name === "string" ? body.name : undefined,
        assumptions: assumptionsFrom(body),
      },
      gate.user.name
    );
    return ok({ scenario }, 201);
  } catch (err) {
    return serviceError(err, "scenario-create");
  }
}
