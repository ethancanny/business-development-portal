import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/capital/http";
import { saveScorecard } from "@/lib/capital/ic";

/**
 * PUT — save the IC scorecard (scores: IC area key → integer 1–5 or
 * null; notes: IC area key → text).
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const scorecard = await saveScorecard(
      params.dealId,
      {
        scores:
          body.scores && typeof body.scores === "object" && !Array.isArray(body.scores)
            ? (body.scores as Record<string, number | null>)
            : undefined,
        notes:
          typeof body.notes === "string"
            ? body.notes
            : body.notes && typeof body.notes === "object" && !Array.isArray(body.notes)
              ? (body.notes as Record<string, string>)
              : undefined,
      },
      gate.user.name
    );
    return ok({ scorecard });
  } catch (err) {
    return serviceError(err, "ic-scorecard-put");
  }
}
