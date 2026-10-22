import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import { updateNode, deleteNode, type UpdateNodePatch } from "@/lib/valuecreation/trees";

/** PATCH — edit a node (label/kind/line/parent/target/unit/notes/sort). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { nodeId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const patch: UpdateNodePatch = {};
    if (typeof body.parentId === "string" || body.parentId === null) {
      patch.parentId = body.parentId as string | null;
    }
    if (typeof body.label === "string") patch.label = body.label;
    if (typeof body.nodeKind === "string") patch.nodeKind = body.nodeKind;
    if (typeof body.lineKey === "string" || body.lineKey === null) {
      patch.lineKey = body.lineKey as string | null;
    }
    if (typeof body.targetValue === "number" || body.targetValue === null) {
      patch.targetValue = body.targetValue as number | null;
    }
    if (typeof body.unit === "string") patch.unit = body.unit;
    if (typeof body.notes === "string") patch.notes = body.notes;
    if (typeof body.sort === "number") patch.sort = body.sort;
    const node = await updateNode(params.nodeId, patch, gate.user.name);
    return ok({ node });
  } catch (err) {
    return serviceError(err, "node-update");
  }
}

/** DELETE — soft-delete the node; children reparent to its parent. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { nodeId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteNode(params.nodeId, gate.user.name);
    if (!deleted) return ok({ error: "node_not_found" }, 404);
    return ok({ deleted: true });
  } catch (err) {
    return serviceError(err, "node-delete");
  }
}
