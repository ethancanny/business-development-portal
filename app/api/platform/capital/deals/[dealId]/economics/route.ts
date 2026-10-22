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
    const patch: EconomicsInputsPatch = {
      ebitdaOverride: sNum(src.ebitdaOverride ?? src.ebitda_override),
      entryMultiple: sNum(src.entryMultiple ?? src.entry_multiple),
      leverageMultiple: sNum(src.leverageMultiple ?? src.leverage_multiple),
      exitMultiple: sNum(src.exitMultiple ?? src.exit_multiple),
      growthPct: sNum(src.growthPct ?? src.growth_pct),
      holdYears: sNum(src.holdYears ?? src.hold_years),
      advisoryFeePct: sNum(src.advisoryFeePct ?? src.advisory_fee_pct),
      financingFeePct: sNum(src.financingFeePct ?? src.financing_fee_pct),
      mgmtFeePct: sNum(src.mgmtFeePct ?? src.mgmt_fee_pct),
      prefPct: sNum(src.prefPct ?? src.pref_pct),
      carryPct: sNum(src.carryPct ?? src.carry_pct),
      rolloverEquity: sNum(src.rolloverEquity ?? src.rollover_equity),
      debtPaydownPct: sNum(src.debtPaydownPct ?? src.debt_paydown_pct),
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
