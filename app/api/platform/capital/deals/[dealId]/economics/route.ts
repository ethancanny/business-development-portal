import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  ok,
  readBody,
  serviceError,
  sNum,
} from "@/lib/capital/http";
import {
  getEconomics,
  saveAndComputeEconomics,
  type EconomicsInputsPatch,
} from "@/lib/capital/economics";

/**
 * Deal economics.
 * GET  — {inputs (stored raw), params, result: snapshot}
 * POST — save provided input fields, then compute + persist the
 *        snapshot; returns {inputs, result}.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    return ok(await getEconomics(params.dealId));
  } catch (err) {
    return serviceError(err, "economics-get");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    // Contract shape is {inputs: {...}, compute} (what the UI sends);
    // flat top-level fields are also accepted for direct API callers.
    const src: Record<string, unknown> =
      body.inputs && typeof body.inputs === "object" && !Array.isArray(body.inputs)
        ? (body.inputs as Record<string, unknown>)
        : body;
    // Presence-based key pick: an explicit null CLEARS the field back
    // to param inheritance, so `??` (which treats null as absent)
    // must not be used to select between the camel/snake spellings.
    const pick = (camel: string, snake: string): number | null | undefined =>
      sNum(camel in src ? src[camel] : src[snake]);
    const patch: EconomicsInputsPatch = {
      ebitdaOverride: pick("ebitdaOverride", "ebitda_override"),
      entryMultiple: pick("entryMultiple", "entry_multiple"),
      leverageMultiple: pick("leverageMultiple", "leverage_multiple"),
      exitMultiple: pick("exitMultiple", "exit_multiple"),
      growthPct: pick("growthPct", "growth_pct"),
      holdYears: pick("holdYears", "hold_years"),
      advisoryFeePct: pick("advisoryFeePct", "advisory_fee_pct"),
      financingFeePct: pick("financingFeePct", "financing_fee_pct"),
      mgmtFeePct: pick("mgmtFeePct", "mgmt_fee_pct"),
      prefPct: pick("prefPct", "pref_pct"),
      carryPct: pick("carryPct", "carry_pct"),
      rolloverEquity: pick("rolloverEquity", "rollover_equity"),
      debtPaydownPct: pick("debtPaydownPct", "debt_paydown_pct"),
    };
    const result = await saveAndComputeEconomics(
      params.dealId,
      patch,
      gate.user.name
    );
    return ok(result);
  } catch (err) {
    return serviceError(err, "economics-post");
  }
}
