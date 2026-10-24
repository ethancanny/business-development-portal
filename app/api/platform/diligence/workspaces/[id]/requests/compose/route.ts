import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import { composeRequestEmail } from "@/lib/diligence/service";

/**
 * POST — compose the ONE request email for outstanding items.
 * Returns { subject, body, mailto, itemCount, templateName }. Sending
 * is via the returned mailto (no Graph mail scope is consented yet);
 * POST ../send records the send once the user has sent it.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const composed = await composeRequestEmail(params.id, {
      templateId:
        typeof body.templateId === "string" ? body.templateId : undefined,
      recipient:
        typeof body.recipient === "string" ? body.recipient : undefined,
      itemIds: Array.isArray(body.itemIds)
        ? body.itemIds.filter(
            (v): v is string => typeof v === "string"
          )
        : undefined,
    });
    return ok(composed);
  } catch (err) {
    return serviceError(err, "requests-compose");
  }
}
