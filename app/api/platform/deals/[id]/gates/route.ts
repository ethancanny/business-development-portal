import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getDeals } from "@/lib/db";
import { DEAL_STAGES } from "@/lib/types";
import {
  evaluateStageGates,
  listGateOverrides,
} from "@/lib/workflow/gates";

/**
 * GET /api/platform/deals/[id]/gates?stage=<target stage>
 * Stage-gate status for one deal (Phase 10): the evaluation of the
 * enabled rules for `stage` (default: the deal's current stage) plus
 * the deal's recorded gate overrides, newest first.
 * Response: { dealId, targetStage, evaluation, overrides }
 *   evaluation = { targetStage, blocked, results: [{key,label,met}],
 *                  unmet: [{key,label}] }
 */

type Params = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Params) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const deals = await getDeals();
  const deal = deals.find((d) => d.id === params.id);
  if (!deal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const requested = req.nextUrl.searchParams.get("stage") ?? "";
  const targetStage = (DEAL_STAGES as readonly string[]).includes(requested)
    ? requested
    : deal.stage;
  const [evaluation, overrides] = await Promise.all([
    evaluateStageGates(params.id, targetStage),
    listGateOverrides(params.id),
  ]);
  return NextResponse.json({
    dealId: params.id,
    targetStage,
    evaluation,
    overrides,
  });
}
