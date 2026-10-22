import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import {
  getQoeWorkbench,
  decideEngineAdjustment,
  createManualAdjustment,
  decideManualAdjustment,
  postAdjustedSet,
} from "@/lib/diligence/qoe";

/**
 * QoE workbench.
 * GET  — adjustments (engine + manual), EBITDA bridge, the distinct
 *        SDE view, and the company's reported/adjusted sets.
 * POST — actions:
 *   { action: "decide-engine", adjustmentId, decision, amount?, inputValue? }
 *   { action: "create-manual", reportedSetId, kind?, label, amount?, direction?, rationale? }
 *   { action: "decide-manual", adjustmentId, decision, amount? }
 *   { action: "post", adjustedSetId }  — posts via financials postSet
 *        with an override note naming the accepted adjustments.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const workbench = await getQoeWorkbench(params.id);
    return ok(workbench);
  } catch (err) {
    return serviceError(err, "qoe-get");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const action = typeof body.action === "string" ? body.action : "";
    const numOrUndef = (v: unknown) =>
      typeof v === "number" ? v : undefined;
    if (action === "decide-engine") {
      const adjustment = await decideEngineAdjustment(
        String(body.adjustmentId ?? ""),
        {
          decision: String(body.decision ?? ""),
          amount: numOrUndef(body.amount),
          inputValue: numOrUndef(body.inputValue),
        },
        gate.user.name
      );
      return ok({ adjustment });
    }
    if (action === "create-manual") {
      const adjustment = await createManualAdjustment(
        params.id,
        {
          reportedSetId: String(body.reportedSetId ?? ""),
          kind: typeof body.kind === "string" ? body.kind : undefined,
          label: typeof body.label === "string" ? body.label : "",
          amount: numOrUndef(body.amount) ?? null,
          direction:
            typeof body.direction === "string" ? body.direction : undefined,
          rationale:
            typeof body.rationale === "string" ? body.rationale : undefined,
        },
        gate.user.name
      );
      return ok({ adjustment }, 201);
    }
    if (action === "decide-manual") {
      const adjustment = await decideManualAdjustment(
        String(body.adjustmentId ?? ""),
        {
          decision: String(body.decision ?? ""),
          amount: numOrUndef(body.amount),
        },
        gate.user.name
      );
      return ok({ adjustment });
    }
    if (action === "post") {
      const result = await postAdjustedSet(
        params.id,
        String(body.adjustedSetId ?? ""),
        gate.user.name
      );
      return ok(result);
    }
    return ok({ error: "unknown_action" }, 400);
  } catch (err) {
    return serviceError(err, "qoe-action");
  }
}
