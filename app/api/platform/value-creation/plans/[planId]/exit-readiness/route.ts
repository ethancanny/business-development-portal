import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import { getExitReadiness, updateExitReadiness } from "@/lib/valuecreation/readiness";

/** GET — exit readiness for the plan (scores + overall + hints). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const readiness = await getExitReadiness(params.planId);
    return ok({ readiness });
  } catch (err) {
    return serviceError(err, "exit-readiness-get");
  }
}

/** PATCH — update area scores ({scores: {areaKey: {score, notes}}}). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const scores =
      body.scores && typeof body.scores === "object" && !Array.isArray(body.scores)
        ? (body.scores as Record<string, { score: number | null; notes?: string }>)
        : {};
    const readiness = await updateExitReadiness(
      params.planId,
      { scores },
      gate.user.name
    );
    return ok({ readiness });
  } catch (err) {
    return serviceError(err, "exit-readiness-update");
  }
}
