import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import { getTree, updateTree, deleteTree } from "@/lib/valuecreation/trees";

/** GET — one tree with its full flat node list. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { treeId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const result = await getTree(params.treeId);
    return ok(result);
  } catch (err) {
    return serviceError(err, "tree-get");
  }
}

/** PATCH — rename a tree. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { treeId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const tree = await updateTree(
      params.treeId,
      { name: typeof body.name === "string" ? body.name : undefined },
      gate.user.name
    );
    return ok({ tree });
  } catch (err) {
    return serviceError(err, "tree-update");
  }
}

/** DELETE — soft-delete the tree and its nodes. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { treeId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteTree(params.treeId, gate.user.name);
    if (!deleted) return ok({ error: "tree_not_found" }, 404);
    return ok({ deleted: true });
  } catch (err) {
    return serviceError(err, "tree-delete");
  }
}
