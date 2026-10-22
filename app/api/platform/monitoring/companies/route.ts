import { NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/monitoring/http";
import { listPortfolioCompanies } from "@/lib/monitoring/service";

/** GET the portfolio company list (lean rows + latest KPI/statuses). */
export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const items = await listPortfolioCompanies();
    return ok({ items, total: items.length });
  } catch (err) {
    return serviceError(err, "companies-list");
  }
}
