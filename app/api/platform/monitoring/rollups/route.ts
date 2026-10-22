import { NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/monitoring/http";
import { getRollups } from "@/lib/monitoring/service";

/** GET the stored portfolio rollup (read model — never recomputed
 * on read; null payload until the first handoff/write refreshes it). */
export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const rollups = await getRollups();
    return ok({ rollups });
  } catch (err) {
    return serviceError(err, "rollups-get");
  }
}
