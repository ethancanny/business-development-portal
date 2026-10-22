import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  internalGate,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/portmgmt/http";
import { listUsers, createUser } from "@/lib/portmgmt/users";

/** GET portal users (internal only). */
export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = internalGate(gate.ctx);
  if (denied) return denied;
  try {
    return ok({ users: await listUsers() });
  } catch (err) {
    return serviceError(err, "users-get");
  }
}

/** POST create a portal user (internal only).
 * Body: { email, name?, role?, companyIds? } */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = internalGate(gate.ctx);
  if (denied) return denied;
  const actor = gate.user.name || gate.user.email;
  try {
    const body = await readBody(req);
    const user = await createUser(
      {
        email: sStr(body.email) ?? "",
        name: sStr(body.name),
        role: sStr(body.role),
        companyIds: Array.isArray(body.companyIds)
          ? body.companyIds.map((x) => String(x))
          : undefined,
      },
      actor
    );
    return ok({ user }, 201);
  } catch (err) {
    return serviceError(err, "users-post");
  }
}
