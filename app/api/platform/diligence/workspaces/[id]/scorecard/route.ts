import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import { getScorecard, updateScorecard } from "@/lib/diligence/service";

/** Controls & systems scorecard — scored areas with notes. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const scorecard = await getScorecard(params.id);
    return ok({ scorecard });
  } catch (err) {
    return serviceError(err, "scorecard-get");
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const scorecard = await updateScorecard(params.id, {
      areas:
        body.areas && typeof body.areas === "object"
          ? (body.areas as Record<
              string,
              { score: number | null; notes: string }
            >)
          : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });
    return ok({ scorecard });
  } catch (err) {
    return serviceError(err, "scorecard-update");
  }
}
