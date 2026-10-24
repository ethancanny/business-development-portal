import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/valuecreation/http";
import { deleteLink } from "@/lib/valuecreation/service";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { initiativeId: string; linkId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteLink(params.linkId, gate.user.name);
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "link-delete");
  }
}
