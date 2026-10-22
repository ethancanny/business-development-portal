import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import { logRequestSend } from "@/lib/diligence/service";

/** POST — record a composed request email as sent (via mailto). */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const send = await logRequestSend(
      params.id,
      {
        recipient:
          typeof body.recipient === "string" ? body.recipient : undefined,
        subject: typeof body.subject === "string" ? body.subject : "",
        body: typeof body.body === "string" ? body.body : "",
        itemIds: Array.isArray(body.itemIds)
          ? (body.itemIds as string[])
          : undefined,
        channel:
          typeof body.channel === "string" ? body.channel : undefined,
      },
      gate.user.name
    );
    return ok({ send }, 201);
  } catch (err) {
    return serviceError(err, "requests-send");
  }
}
