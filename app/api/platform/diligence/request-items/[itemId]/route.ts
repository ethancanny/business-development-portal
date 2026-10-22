import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import { updateRequestItem } from "@/lib/diligence/service";

/** PATCH — track a response against a request item. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { itemId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const item = await updateRequestItem(params.itemId, {
      status: typeof body.status === "string" ? body.status : undefined,
      responseNotes:
        typeof body.responseNotes === "string"
          ? body.responseNotes
          : undefined,
    });
    return ok({ item });
  } catch (err) {
    return serviceError(err, "request-item-update");
  }
}
