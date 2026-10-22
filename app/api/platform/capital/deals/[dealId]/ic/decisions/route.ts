import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/capital/http";
import { logDecision } from "@/lib/capital/ic";

/**
 * POST — log an IC decision {decision, conditions, votes, notes}.
 * votes: [{voter, vote: approve|decline|abstain}].
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const decision = await logDecision(
      params.dealId,
      {
        decision: sStr(body.decision),
        conditions: sStr(body.conditions),
        votes: Array.isArray(body.votes)
          ? (body.votes as Array<{ voter?: unknown; vote?: unknown }>)
          : undefined,
        notes: sStr(body.notes),
      },
      gate.user.name
    );
    return ok({ decision }, 201);
  } catch (err) {
    return serviceError(err, "ic-decision-post");
  }
}
