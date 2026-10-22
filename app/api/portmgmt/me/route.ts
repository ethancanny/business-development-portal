import { NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/portmgmt/http";

/** GET the signed-in portal user's identity + access context. */
export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    return ok({
      user: gate.user,
      role: gate.ctx.role,
      companyIds: gate.ctx.companyIds,
    });
  } catch (err) {
    return serviceError(err, "me-get");
  }
}
