import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import {
  getScenario,
  updateScenario,
  deleteScenario,
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

/** GET — one scenario with its bridge. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { scenarioId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const scenario = await getScenario(params.scenarioId);
    return ok({ scenario });
  } catch (err) {
    return serviceError(err, "scenario-get");
  }
}

/** PATCH — rename and/or change assumptions (bridge recomputed). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { scenarioId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const scenario = await updateScenario(
      params.scenarioId,
      {
        name: typeof body.name === "string" ? body.name : undefined,
        assumptions: assumptionsFrom(body),
      },
      gate.user.name
    );
    return ok({ scenario });
  } catch (err) {
    return serviceError(err, "scenario-update");
  }
}

/** DELETE — soft-delete the scenario. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { scenarioId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteScenario(params.scenarioId, gate.user.name);
    if (!deleted) return ok({ error: "scenario_not_found" }, 404);
    return ok({ deleted: true });
  } catch (err) {
    return serviceError(err, "scenario-delete");
  }
}
