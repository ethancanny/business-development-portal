import { NextRequest, NextResponse } from "next/server";
import { authed, serviceError, NO_STORE } from "@/lib/comms/http";
import { getReport } from "@/lib/comms/service";
import { getReportPdf, storeReportPdf } from "@/lib/comms/pdf";

/**
 * GET the stored PDF for the report's current version
 * (application/pdf, internal full render). Generated on demand via
 * lib/comms/pdf storeReportPdf when no stored file exists yet.
 */
export async function GET(
  _req: NextRequest,
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
    const version = report.currentVersion || 1;
    let buffer = await getReportPdf(params.id, version);
    if (!buffer) {
      if (!report.render) {
        return NextResponse.json(
          { error: "pdf_not_found" },
          { status: 404, headers: NO_STORE }
        );
      }
      const stored = await storeReportPdf(
        {
          id: report.id,
          title: report.title,
          currentVersion: version,
          isSample: report.isSample,
        },
        report.render
      );
      buffer = stored.buffer;
    }
    return new NextResponse(buffer as BodyInit, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="report-${params.id}-v${version}.pdf"`,
      },
    });
  } catch (err) {
    return serviceError(err, "report-pdf");
  }
}
