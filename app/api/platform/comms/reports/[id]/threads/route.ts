import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError, NO_STORE } from "@/lib/comms/http";
import { createComment, listComments } from "@/lib/platform/collab";

/**
 * Report discussion threads — backed by the platform collab comments
 * with entityKind 'comms_report'. Recipient replies land here too
 * (delivery.postRecipientReply writes through the same store).
 * Verified against lib/platform/collab.ts:
 *   listComments(entityKind, entityId, limit?)
 *   createComment({ entityKind, entityId, body, author, actorEmail })
 */

/** GET the thread for this report. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const items = await listComments("comms_report", params.id);
    return ok({ items });
  } catch (err) {
    return serviceError(err, "report-threads-list");
  }
}

/** POST an internal reply on this report's thread. */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!text) {
      return NextResponse.json(
        { error: "body_required" },
        { status: 400, headers: NO_STORE }
      );
    }
    const comment = await createComment({
      entityKind: "comms_report",
      entityId: params.id,
      body: text,
      author: gate.user.name || gate.user.email,
      actorEmail: gate.user.email,
    });
    return ok({ comment });
  } catch (err) {
    return serviceError(err, "report-threads-create");
  }
}
