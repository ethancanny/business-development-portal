import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import { listMaps, createMap } from "@/lib/valuecreation/bpmn";

/** GET — to-be map list for the plan. NEVER includes XML. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const maps = await listMaps(params.planId);
    return ok({ maps });
  } catch (err) {
    return serviceError(err, "bpmn-list");
  }
}

/** POST — create a to-be map (optionally linked to an as-is diagram). */
export async function POST(
  req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const map = await createMap(
      params.planId,
      {
        name: typeof body.name === "string" ? body.name : "",
        processKey: typeof body.processKey === "string" ? body.processKey : undefined,
        asIsDiagramId:
          typeof body.asIsDiagramId === "string" || body.asIsDiagramId === null
            ? (body.asIsDiagramId as string | null)
            : undefined,
        asIsLabel: typeof body.asIsLabel === "string" ? body.asIsLabel : undefined,
      },
      gate.user.name
    );
    return ok({ map }, 201);
  } catch (err) {
    return serviceError(err, "bpmn-create");
  }
}
