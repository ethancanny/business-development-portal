import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import { updateFinding, deleteFinding } from "@/lib/diligence/service";

/** PATCH — edit a finding or decide its proposed term (accepted/rejected). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { fid: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const s = (v: unknown) => (typeof v === "string" ? v : undefined);
    const finding = await updateFinding(
      params.fid,
      {
        title: s(body.title),
        detail: s(body.detail),
        category: s(body.category),
        severity: s(body.severity),
        proposedTermType: s(body.proposedTermType),
        proposedTermDetail: s(body.proposedTermDetail),
        status: s(body.status),
      },
      gate.user.name
    );
    return ok({ finding });
  } catch (err) {
    return serviceError(err, "finding-update");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { fid: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteFinding(params.fid);
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "finding-delete");
  }
}
