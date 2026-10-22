import { NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/monitoring/http";
import {
  getMonitoringSummaryForCompany,
  getPortfolioCompany,
  MonitoringError,
} from "@/lib/monitoring/service";

/** GET one portfolio company: handoff record + baseline copies +
 * the compact monitoring summary. */
export async function GET(
  _req: Request,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const company = await getPortfolioCompany(params.companyId);
    if (!company) throw new MonitoringError("portfolio_company_not_found");
    const summary = await getMonitoringSummaryForCompany(params.companyId);
    return ok({ company, summary });
  } catch (err) {
    return serviceError(err, "company-get");
  }
}
