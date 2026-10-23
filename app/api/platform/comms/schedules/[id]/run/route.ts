import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/comms/http";
import { enqueueJobAt } from "@/lib/platform/jobs";

/** POST run a schedule now: enqueues the comms_schedule_run job due
 *  immediately (the job handler applies the data checks, pause
 *  rules, and routine-approval gate before generating/sending). */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const jobId = await enqueueJobAt(
      "comms_schedule_run",
      { scheduleId: params.id },
      new Date()
    );
    return ok({ enqueued: true, jobId });
  } catch (err) {
    return serviceError(err, "schedule-run");
  }
}
