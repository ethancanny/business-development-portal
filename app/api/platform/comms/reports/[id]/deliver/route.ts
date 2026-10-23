import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError, NO_STORE } from "@/lib/comms/http";
import { deliverReport } from "@/lib/comms/delivery";

/**
 * POST deliver an APPROVED report to recipients:
 * { recipients: [{ personId?, name, email, allowPdf }], override?,
 *   overrideReason? }
 * A blocked pre-send check without an override surfaces as
 * 409 + the check payload (the service throws 'send_blocked' with
 * the check attached); an override is audit-logged by the service.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
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
                : undefined,
          name: typeof r.name === "string" ? r.name : "",
          email: typeof r.email === "string" ? r.email : "",
          allowPdf:
            typeof r.allowPdf === "boolean"
              ? r.allowPdf
              : typeof r.allow_pdf === "boolean"
                ? (r.allow_pdf as boolean)
                : false,
        }))
      : [];
    const result = await deliverReport(
      params.id,
      {
        recipients,
        override: body.override === true,
        overrideReason:
          typeof body.overrideReason === "string"
            ? body.overrideReason
            : undefined,
      } as Parameters<typeof deliverReport>[1],
      gate.user.name || gate.user.email
    );
    return ok(result as Record<string, unknown>);
  } catch (err) {
    const rec =
      err && typeof err === "object" ? (err as Record<string, unknown>) : null;
    const code =
      (typeof rec?.error === "string" && rec.error) ||
      (err instanceof Error ? err.message : "");
    if (code === "send_blocked") {
      return NextResponse.json(
        { error: "send_blocked", check: rec?.check ?? null },
        { status: 409, headers: NO_STORE }
      );
    }
    return serviceError(err, "report-deliver");
  }
}
