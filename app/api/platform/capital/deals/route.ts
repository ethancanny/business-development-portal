import { NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/capital/http";
import { listCapitalDeals } from "@/lib/capital/service";

/** GET capital deals index: every core deal + its deal_summary row. */
export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const items = await listCapitalDeals();
    return ok({ items });
  } catch (err) {
    return serviceError(err, "deals-list");
  }
}
