import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/diligence/http";
import { getDiagramVersionXml } from "@/lib/diligence/bpmn";

/** GET — one prior version's XML (single-record read). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { diagramId: string; version: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const version = Number(params.version);
    if (!Number.isInteger(version) || version < 1) {
      return ok({ error: "version_not_found" }, 404);
    }
    const result = await getDiagramVersionXml(params.diagramId, version);
    return ok(result);
  } catch (err) {
    return serviceError(err, "bpmn-version-get");
  }
}
