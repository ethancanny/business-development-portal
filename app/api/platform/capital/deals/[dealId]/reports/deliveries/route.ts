import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/capital/http";
import { listDealReportDeliveries } from "@/lib/capital/reporting";

/**
 * Delivery log for a deal's reports (Send anywhere, Oct 25, 2026):
 * the comms module's real delivery rows for reports linked to this
 * deal — recipient, sent time, email outcome, pixel-open stamp and
 * portal open/view/download stamps. Read on tab open only.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deliveries = await listDealReportDeliveries(params.dealId);
    return ok({ deliveries });
  } catch (err) {
    return serviceError(err, "capital-report-deliveries");
  }
}
