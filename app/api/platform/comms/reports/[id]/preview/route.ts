import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError, NO_STORE } from "@/lib/comms/http";
import { getReport } from "@/lib/comms/service";
import { filterRenderForAudience } from "@/lib/comms/filter";
import { buildPreviewMeta, dedupeFigures } from "@/lib/comms/delivery";

/**
 * GET the recipient preview: filterRenderForAudience(stored render,
 * audience) — the EXACT pure function the recipient GET uses, so
 * "what this recipient will see" is never a locally filtered copy.
 * ?audience= defaults to the report audience; ?personId= names the
 * recipient being previewed (their name/org fill the meta's
 * "Prepared for" — filtering itself stays audience-based). The
 * response also carries the recipient meta + visible appendix so
 * the preview renders the identical document the recipient gets.
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
    const personId = req.nextUrl.searchParams.get("personId") || null;
    let recipientName = "";
    let recipientEmail = "";
    if (personId) {
      try {
        const { getDirectoryDetail } = await import("@/lib/directory/service");
        const detail = await getDirectoryDetail("person", personId);
        const rec = (detail?.record ?? {}) as Record<string, unknown>;
        if (typeof rec.name === "string") recipientName = rec.name;
        if (typeof rec.email === "string") recipientEmail = rec.email;
      } catch {
        /* preview still renders without a named recipient */
      }
    }
    const meta = await buildPreviewMeta(report, {
      audience,
      personId,
      recipientName,
      recipientEmail,
    });
    return ok({ render, audience, meta, appendix: dedupeFigures(render) });
  } catch (err) {
    return serviceError(err, "report-preview");
  }
}
