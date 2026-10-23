import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError, NO_STORE } from "@/lib/comms/http";
import { getReport, updateReport } from "@/lib/comms/service";
import { generateNarrative } from "@/lib/comms/ai";

/**
 * POST narrative work for a report.
 * - { mode: "ai" } (default): ai.generateNarrative — returns the
 *   honest narrative_status ('ready' | 'setup_required' |
 *   'blocked_disabled' | 'error' | 'none'); text is NEVER fabricated
 *   when the provider is unconfigured or disabled for the deal.
 * - { narrative: { [blockKey]: statements[] } }: manual statements,
 *   delegated to updateReport (writes a new version).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const actor = gate.user.name || gate.user.email;
  try {
    const body = await readBody(req);
    if (body.narrative && typeof body.narrative === "object") {
      const report = await updateReport(
        params.id,
        {
          narrative: body.narrative,
        } as Parameters<typeof updateReport>[1],
        actor
      );
      return ok({ report, narrativeStatus: "manual" });
    }
    const report = await getReport(params.id);
    if (!report) {
      return NextResponse.json(
        { error: "report_not_found" },
        { status: 404, headers: NO_STORE }
      );
    }
    const result = await generateNarrative(report, actor);
    return ok({
      narrativeStatus: result.status,
      detail: result.detail,
      statementCount: result.statementCount,
      result,
    });
  } catch (err) {
    return serviceError(err, "report-narrative");
  }
}
