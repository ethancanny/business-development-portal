import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import { updateRedFlag, deleteRedFlag } from "@/lib/diligence/service";

/**
 * PATCH — edit a red flag. Moving a candidate to any non-candidate
 * status is the reviewer confirmation (stamps confirmedBy); status
 * 'dismissed' is the rejection path for candidates.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { rid: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const s = (v: unknown) => (typeof v === "string" ? v : undefined);
    const flag = await updateRedFlag(
      params.rid,
      {
        title: s(body.title),
        detail: s(body.detail),
        severity: s(body.severity),
        owner: s(body.owner),
        mitigation: s(body.mitigation),
        status: s(body.status),
      },
      gate.user.name
    );
    return ok({ flag });
  } catch (err) {
    return serviceError(err, "red-flag-update");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { rid: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteRedFlag(params.rid);
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "red-flag-delete");
  }
}
