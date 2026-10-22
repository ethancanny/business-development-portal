import { NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/monitoring/http";
import { listPortfolioCompanies } from "@/lib/monitoring/service";

/** GET the portfolio company list (lean rows + latest KPI/statuses). */
export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const all = await listPortfolioCompanies();
    // Phase 9: company-scoped sessions see only their own companies.
    const items =
      gate.ctx.companyIds === null
        ? all
        : all.filter((it) => gate.ctx.companyIds!.includes(it.companyId));
    return ok({ items, total: items.length });
  } catch (err) {
    return serviceError(err, "companies-list");
  }
}
