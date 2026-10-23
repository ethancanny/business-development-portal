import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/comms/http";
import { createReport, listReports } from "@/lib/comms/service";

/** GET report list (?status&companyId&dealId&personId). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const sp = req.nextUrl.searchParams;
    const result = (await listReports({
      status: sp.get("status") ?? undefined,
      companyId: sp.get("companyId") ?? undefined,
      dealId: sp.get("dealId") ?? undefined,
    })) as unknown;
    const items = Array.isArray(result)
      ? result
      : ((result as { items?: unknown[] })?.items ?? []);
    return ok({ items });
  } catch (err) {
    return serviceError(err, "reports-list");
  }
}

/** POST create a report — the service creates the row in status
 *  'generating' and enqueues the comms_generate_report job. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const s = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    const input = {
      templateId: s(body.templateId) ?? s(body.template_id),
      subjectKind: s(body.subjectKind) ?? s(body.subject_kind),
      companyId: s(body.companyId) ?? s(body.company_id),
      dealId: s(body.dealId) ?? s(body.deal_id),
      personId: s(body.personId) ?? s(body.person_id),
      title: s(body.title),
      isSample:
        typeof body.isSample === "boolean"
          ? body.isSample
          : typeof body.is_sample === "boolean"
            ? body.is_sample
            : typeof body.sample === "boolean"
              ? body.sample
              : undefined,
    };
    const report = await createReport(
      input as Parameters<typeof createReport>[0],
      gate.user.name || gate.user.email
    );
    return ok({ report });
  } catch (err) {
    return serviceError(err, "reports-create");
  }
}
