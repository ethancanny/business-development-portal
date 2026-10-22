import { NextResponse } from "next/server";
import { authed, companyGate, ok, serviceError } from "@/lib/monitoring/http";
import {
  deletePortfolioCompany,
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
  const forbidden = companyGate(gate.ctx, params.companyId);
  if (forbidden) return forbidden;
  try {
    const company = await getPortfolioCompany(params.companyId);
    if (!company) throw new MonitoringError("portfolio_company_not_found");
    const summary = await getMonitoringSummaryForCompany(params.companyId);
    return ok({ company, summary });
  } catch (err) {
    return serviceError(err, "company-get");
  }
}

/** DELETE: soft-delete the portfolio company (restorable; children
 * remain as history). Rollups refresh inside the service. */
export async function DELETE(
  _req: Request,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const forbidden = companyGate(gate.ctx, params.companyId);
  if (forbidden) return forbidden;
  try {
    const removed = await deletePortfolioCompany(
      params.companyId,
      gate.user.name ?? ""
    );
    if (!removed) throw new MonitoringError("portfolio_company_not_found");
    return ok({ deleted: true });
  } catch (err) {
    return serviceError(err, "company-delete");
  }
}
