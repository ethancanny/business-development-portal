import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/valuecreation/http";
import { listMapVersions } from "@/lib/valuecreation/bpmn";

/** GET — version metadata only (version, savedBy, time, size). No XML. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { diagramId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const versions = await listMapVersions(params.diagramId);
    return ok({ versions });
  } catch (err) {
    return serviceError(err, "bpmn-versions");
  }
}
