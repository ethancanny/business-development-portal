import { NextResponse } from "next/server";
import { authed, NO_STORE, ok, serviceError } from "@/lib/capital/http";
import { listCapitalDeals } from "@/lib/capital/service";
import { getAccessContext } from "@/lib/platform/permissions";

/** GET capital deals index: every core deal + its deal_summary row. */
export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  // Phase 9: capital deal data is internal-only.
  const ctx = await getAccessContext(gate.user);
  if (ctx.companyIds !== null) {
    return NextResponse.json(
      { error: "internal_only" },
      { status: 403, headers: NO_STORE }
    );
  }
  try {
    const items = await listCapitalDeals();
    return ok({ items });
  } catch (err) {
    return serviceError(err, "deals-list");
  }
}
