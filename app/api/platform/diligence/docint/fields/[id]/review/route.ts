import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import { reviewField } from "@/lib/docint/service";

/**
 * POST { action: 'confirm'|'correct'|'reject', valueText? } — review
 * one extracted field. 'correct' requires valueText (stored as the
 * field's corrected value). Stamps reviewed_by / reviewed_at.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const action =
      typeof body.action === "string" ? body.action : "";
    if (
      action !== "confirm" &&
      action !== "correct" &&
      action !== "reject"
    ) {
      return ok({ error: "invalid_action" }, 400);
    }
    const field = await reviewField(
      params.id,
      {
        action,
        valueText:
          typeof body.valueText === "string" ? body.valueText : undefined,
      },
      gate.user.name
    );
    return ok({ field });
  } catch (err) {
    return serviceError(err, "docint-field-review");
  }
}
