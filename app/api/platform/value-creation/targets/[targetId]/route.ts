import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/valuecreation/http";
import { deleteTarget } from "@/lib/valuecreation/service";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { targetId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteTarget(params.targetId, gate.user.name);
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "target-delete");
  }
}
