import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/monitoring/http";
import { setBudgetVersionStatus } from "@/lib/monitoring/analytics";

/** POST { status } — transition a budget version
 * (draft → submitted → approved; approving supersedes the previously
 * approved version for the same company + fiscal year). */
export async function POST(
  req: NextRequest,
  { params }: { params: { companyId: string; versionId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  const actor = gate.user.name || gate.user.email;
  try {
    const body = await readBody(req);
    const version = await setBudgetVersionStatus(
      params.versionId,
      sStr(body.status) ?? "",
      actor
    );
    if (version.companyId !== params.companyId) {
      return serviceError(new Error("budget_version_not_found"), "budget-version-status");
    }
    return ok({ version });
  } catch (err) {
    return serviceError(err, "budget-version-status");
  }
}
