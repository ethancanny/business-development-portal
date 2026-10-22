import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  internalGate,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/monitoring/http";
import {
  getAlertRules,
  upsertAlertRule,
} from "@/lib/monitoring/analytics";

/** GET the merged alert-rule view for the company (company override
 * over global over defaults, per rule). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const forbidden = companyGate(gate.ctx, params.companyId);
  if (forbidden) return forbidden;
  try {
    return ok(await getAlertRules(params.companyId));
  } catch (err) {
    return serviceError(err, "alert-rules-get");
  }
}

/** PUT upsert an alert rule. Body: { ruleKey, enabled, params,
 * scope?: 'company'|'global' } — default scope is the company in the
 * path; scope 'global' (or companyId: null) writes the global row. */
export async function PUT(
  req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const forbidden = companyGate(gate.ctx, params.companyId);
  if (forbidden) return forbidden;
  try {
    const body = await readBody(req);
    const isGlobal =
      sStr(body.scope) === "global" || body.companyId === null;
    // A company-scoped session may never write the GLOBAL rule row,
    // even through a company path it is allowed to reach.
    if (isGlobal) {
      const internalOnly = internalGate(gate.ctx);
      if (internalOnly) return internalOnly;
    }
    const paramsObj =
      body.params && typeof body.params === "object"
        ? (body.params as Record<string, unknown>)
        : {};
    const rule = await upsertAlertRule(
      isGlobal ? null : params.companyId,
      sStr(body.ruleKey) ?? sStr(body.rule_key) ?? "",
      typeof body.enabled === "boolean" ? body.enabled : true,
      paramsObj,
      gate.user.name || gate.user.email
    );
    return ok({ rule });
  } catch (err) {
    return serviceError(err, "alert-rules-put");
  }
}
