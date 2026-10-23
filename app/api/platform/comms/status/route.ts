import { NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/comms/http";
import { getCommsStatus } from "@/lib/comms/service";

/** GET comms status: AI provider state + email transport state +
 *  counts, exactly as the service reports them (never embellished —
 *  the UI renders setup_required / unknown states honestly). */
export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    return ok(await getCommsStatus());
  } catch (err) {
    return serviceError(err, "status");
  }
}
