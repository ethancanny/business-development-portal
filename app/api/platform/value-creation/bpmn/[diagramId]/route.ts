import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/valuecreation/http";
import { getMap, deleteMap } from "@/lib/valuecreation/bpmn";

/** GET — one to-be map WITH its current XML (single-record read). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { diagramId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const map = await getMap(params.diagramId);
    return ok({ map });
  } catch (err) {
    return serviceError(err, "bpmn-get");
  }
}

/** DELETE — soft-delete the map (versions retained as history). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { diagramId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteMap(params.diagramId, gate.user.name);
    if (!deleted) return ok({ error: "diagram_not_found" }, 404);
    return ok({ deleted: true });
  } catch (err) {
    return serviceError(err, "bpmn-delete");
  }
}
