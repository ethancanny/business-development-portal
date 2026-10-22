import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  initiativeInputFrom,
  ok,
  readBody,
  serviceError,
} from "@/lib/valuecreation/http";
import {
  deleteInitiative,
  updateInitiative,
} from "@/lib/valuecreation/service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { initiativeId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const initiative = await updateInitiative(
      params.initiativeId,
      initiativeInputFrom(body),
      gate.user.name
    );
    return ok({ initiative });
  } catch (err) {
    return serviceError(err, "initiative-update");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { initiativeId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteInitiative(params.initiativeId, gate.user.name);
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "initiative-delete");
  }
}
