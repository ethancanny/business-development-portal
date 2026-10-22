import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  internalGate,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/portmgmt/http";
import { updateUser, deleteUser } from "@/lib/portmgmt/users";

/** PATCH a portal user (internal only). Body: { name?, role?, companyIds? } */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { email: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = internalGate(gate.ctx);
  if (denied) return denied;
  const actor = gate.user.name || gate.user.email;
  try {
    const body = await readBody(req);
    const user = await updateUser(
      decodeURIComponent(params.email),
      {
        name: sStr(body.name),
        role: sStr(body.role),
        companyIds: Array.isArray(body.companyIds)
          ? body.companyIds.map((x) => String(x))
          : undefined,
      },
      actor
    );
    return ok({ user });
  } catch (err) {
    return serviceError(err, "users-patch");
  }
}

/** DELETE (soft) a portal user (internal only). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { email: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = internalGate(gate.ctx);
  if (denied) return denied;
  const actor = gate.user.name || gate.user.email;
  try {
    const deleted = await deleteUser(decodeURIComponent(params.email), actor);
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "users-delete");
  }
}
