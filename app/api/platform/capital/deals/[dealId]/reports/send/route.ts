import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError, sStr } from "@/lib/capital/http";
import { sendInvestorReport } from "@/lib/capital/reporting";

/**
 * Send a capital report to investors (Send anywhere, Oct 25, 2026):
 * renders the capital template, bridges the render into comms and
 * delivers through deliverReport (pre-send check, tokens, codename
 * rules, delivery log). A blocked pre-send check surfaces as
 * 409 + the check payload, mirroring the comms deliver route.
 * Body: { templateId, recipients: [{ personId?, name, email, allowPdf? }] }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const recipients = Array.isArray(body.recipients)
      ? (body.recipients as Array<Record<string, unknown>>).map((r) => ({
          personId:
            typeof r.personId === "string"
              ? r.personId
              : typeof r.person_id === "string"
                ? (r.person_id as string)
                : null,
          name: typeof r.name === "string" ? r.name : "",
          email: typeof r.email === "string" ? r.email : "",
          allowPdf: r.allowPdf === true,
        }))
      : [];
    const result = await sendInvestorReport(
      params.dealId,
      { templateId: sStr(body.templateId) ?? "", recipients },
      gate.user.name || gate.user.email
    );
    return ok(result as unknown as Record<string, unknown>, 201);
  } catch (err) {
    const rec =
      err && typeof err === "object" ? (err as Record<string, unknown>) : null;
    const code =
      (typeof rec?.error === "string" && rec.error) ||
      (err instanceof Error ? err.message : "");
    if (code === "send_blocked") {
      return NextResponse.json(
        { error: "send_blocked", check: rec?.check ?? null },
        { status: 409, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    return serviceError(err, "capital-report-send");
  }
}
