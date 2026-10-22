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
    const patch: EconomicsInputsPatch = {
      ebitdaOverride: sNum(body.ebitdaOverride ?? body.ebitda_override),
      entryMultiple: sNum(body.entryMultiple ?? body.entry_multiple),
      leverageMultiple: sNum(body.leverageMultiple ?? body.leverage_multiple),
      exitMultiple: sNum(body.exitMultiple ?? body.exit_multiple),
      growthPct: sNum(body.growthPct ?? body.growth_pct),
      holdYears: sNum(body.holdYears ?? body.hold_years),
      advisoryFeePct: sNum(body.advisoryFeePct ?? body.advisory_fee_pct),
      financingFeePct: sNum(body.financingFeePct ?? body.financing_fee_pct),
      mgmtFeePct: sNum(body.mgmtFeePct ?? body.mgmt_fee_pct),
      prefPct: sNum(body.prefPct ?? body.pref_pct),
      carryPct: sNum(body.carryPct ?? body.carry_pct),
      rolloverEquity: sNum(body.rolloverEquity ?? body.rollover_equity),
      debtPaydownPct: sNum(body.debtPaydownPct ?? body.debt_paydown_pct),
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
