import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/comms/http";
import { getReport } from "@/lib/comms/service";
import { enqueueJob } from "@/lib/platform/jobs";

/** POST enqueue a (re)generation of this report. The job handler
 *  (lib/comms/jobs runCommsGenerateJob → generateReportNow) does the
 *  assembly; this route returns the current report detail. */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    await enqueueJob("comms_generate_report", { reportId: params.id });
    const report = await getReport(params.id);
    return ok({ report, enqueued: true });
  } catch (err) {
    return serviceError(err, "report-generate");
  }
}
