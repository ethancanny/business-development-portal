import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/capital/http";
import { renderReport } from "@/lib/capital/reporting";

/**
 * POST — render a template for a deal:
 * {dealId, templateId, investorPersonId?, asOf?} → {text, values}.
 * Unknown placeholders are left as-is.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const result = await renderReport({
      dealId: sStr(body.dealId ?? body.deal_id) ?? "",
      templateId: sStr(body.templateId ?? body.template_id) ?? "",
      investorPersonId: sStr(
        body.investorPersonId ?? body.investor_person_id
      ),
      asOf: sStr(body.asOf ?? body.as_of),
    });
    return ok(result);
  } catch (err) {
    return serviceError(err, "report-templates-render");
  }
}
