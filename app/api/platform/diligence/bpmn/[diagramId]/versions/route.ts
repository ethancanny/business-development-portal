import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/diligence/http";
import { listDiagramVersions } from "@/lib/diligence/bpmn";

/** GET — version metadata only (version, savedBy, time, size). No XML. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { diagramId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const versions = await listDiagramVersions(params.diagramId);
    return ok({ versions });
  } catch (err) {
    return serviceError(err, "bpmn-versions");
  }
}
