import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import { applyRunToRegister } from "@/lib/docint/service";

/**
 * POST { runId } — apply a run's confirmed/corrected fields to the
 * diligence contract register (creates one contract via the
 * diligence service and marks the fields applied).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const runId = typeof body.runId === "string" ? body.runId : "";
    if (!runId) return ok({ error: "run_id_required" }, 400);
    const contract = await applyRunToRegister(runId, gate.user.name);
    return ok({ contract }, 201);
  } catch (err) {
    return serviceError(err, "docint-apply");
  }
}
