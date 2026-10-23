import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError, NO_STORE } from "@/lib/comms/http";
import { getReport } from "@/lib/comms/service";

/** GET version metadata for a report (from the getReport detail). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const detail = await getReport(params.id);
    if (!detail) {
      return NextResponse.json(
        { error: "report_not_found" },
        { status: 404, headers: NO_STORE }
      );
    }
    return ok({ versions: detail.versions, currentVersion: detail.currentVersion });
  } catch (err) {
    return serviceError(err, "report-versions");
  }
}
