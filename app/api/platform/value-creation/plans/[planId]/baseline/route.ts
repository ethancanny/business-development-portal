import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import { getBaselineState, lockBaseline } from "@/lib/valuecreation/service";

/** GET the baseline snapshot state (current + versions + variance). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const baseline = await getBaselineState(params.planId);
    return ok({ baseline });
  } catch (err) {
    return serviceError(err, "baseline-get");
  }
}

/** POST locks a new baseline snapshot (supersedes the previous one). */
export async function POST(
  req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const baseline = await lockBaseline(
      params.planId,
      { note: typeof body.note === "string" ? body.note : undefined },
      gate.user.name
    );
    return ok({ baseline });
  } catch (err) {
    return serviceError(err, "baseline-lock");
  }
}
