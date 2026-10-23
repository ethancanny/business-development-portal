import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/comms/http";
import { transitionReport } from "@/lib/comms/service";

/** POST submit for review (draft → in_review). */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const report = await transitionReport(
      params.id,
      "submit",
      gate.user.name || gate.user.email
    );
    return ok({ report });
  } catch (err) {
    return serviceError(err, "report-submit");
  }
}
