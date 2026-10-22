import { NextResponse } from "next/server";
import { authed, internalGate, ok, serviceError } from "@/lib/monitoring/http";
import { getRollups } from "@/lib/monitoring/service";

/** GET the stored portfolio rollup (read model — never recomputed
 * on read; null payload until the first handoff/write refreshes it).
 * Portfolio-wide: internal sessions only (Phase 9 scoping). */
export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const internalOnly = internalGate(gate.ctx);
  if (internalOnly) return internalOnly;
  try {
    const rollups = await getRollups();
    return ok({ rollups });
  } catch (err) {
    return serviceError(err, "rollups-get");
  }
}
