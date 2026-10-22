import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import { saveMapXml } from "@/lib/valuecreation/bpmn";

/**
 * POST — EXPLICIT save only (no autosave anywhere). Stores the XML as
 * a new compressed version; keeps at most 10 prior versions.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { diagramId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const result = await saveMapXml(
      params.diagramId,
      typeof body.xml === "string" ? body.xml : "",
      gate.user.name
    );
    return ok(result);
  } catch (err) {
    return serviceError(err, "bpmn-save");
  }
}
