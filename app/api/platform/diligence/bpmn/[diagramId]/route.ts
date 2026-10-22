import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import { getDiagram, saveDiagramXml } from "@/lib/diligence/bpmn";

/** GET — one diagram WITH its current XML (single-record read). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { diagramId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const diagram = await getDiagram(params.diagramId);
    return ok({ diagram });
  } catch (err) {
    return serviceError(err, "bpmn-get");
  }
}

/**
 * PUT — EXPLICIT save only (no autosave anywhere). Stores the XML as a
 * new compressed version; keeps at most 10 prior versions.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { diagramId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const result = await saveDiagramXml(
      params.diagramId,
      typeof body.xml === "string" ? body.xml : "",
      gate.user.name
    );
    return ok(result);
  } catch (err) {
    return serviceError(err, "bpmn-save");
  }
}
