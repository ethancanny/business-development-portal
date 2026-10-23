import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError, NO_STORE } from "@/lib/comms/http";
import { getReport } from "@/lib/comms/service";
import { runPreSendCheck } from "@/lib/comms/filter";

/**
 * GET pre-send check for a hypothetical audience
 * (?audience=, defaulting to the report's own audience). Returns
 * { blocked, flagged, excluded } from lib/comms/filter — the same
 * check deliverReport runs for real recipients. The hypothetical
 * recipient carries only the audience under test.
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
    const check = await runPreSendCheck(report, [
      { name: "", email: "", audience },
    ]);
    return ok({ check, audience });
  } catch (err) {
    return serviceError(err, "report-check");
  }
}
