import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/capital/http";
import { deleteReportEntry } from "@/lib/capital/reporting";

/** DELETE — soft-delete a report entry and refresh the deal summary. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { dealId: string; entryId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteReportEntry(params.dealId, params.entryId);
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "reporting-delete");
  }
}
