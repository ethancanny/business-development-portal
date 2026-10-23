import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError, NO_STORE } from "@/lib/comms/http";
import { getReport } from "@/lib/comms/service";
import { filterRenderForAudience } from "@/lib/comms/filter";

/**
 * GET the recipient preview: filterRenderForAudience(stored render,
 * audience) — the EXACT pure function the recipient GET uses, so
 * "what this recipient will see" is never a locally filtered copy.
 * ?audience= defaults to the report audience; ?personId= is accepted
 * (the recipient being previewed) but filtering is audience-based.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const report = await getReport(params.id);
    if (!report) {
      return NextResponse.json(
        { error: "report_not_found" },
        { status: 404, headers: NO_STORE }
      );
    }
    const audience =
      req.nextUrl.searchParams.get("audience") || report.audience;
    if (!report.render) return ok({ render: null, audience });
    const render = filterRenderForAudience(report.render, audience);
    return ok({ render, audience });
  } catch (err) {
    return serviceError(err, "report-preview");
  }
}
