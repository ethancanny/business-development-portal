import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/diligence/http";
import { listDiagrams } from "@/lib/diligence/bpmn";

/** GET — diagram list for the workspace. NEVER includes XML. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const diagrams = await listDiagrams(params.id);
    return ok({ diagrams });
  } catch (err) {
    return serviceError(err, "bpmn-list");
  }
}
