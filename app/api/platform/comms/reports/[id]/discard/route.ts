import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/comms/http";
import { transitionReport } from "@/lib/comms/service";

/** POST discard (draft/in_review → discarded). */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const report = await transitionReport(
      params.id,
      "discard",
      gate.user.name || gate.user.email
    );
    return ok({ report });
  } catch (err) {
    return serviceError(err, "report-discard");
  }
}
