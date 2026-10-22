import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import { createNode } from "@/lib/valuecreation/trees";

/** POST — add a node to the tree. */
export async function POST(
  req: NextRequest,
  { params }: { params: { treeId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const node = await createNode(
      params.treeId,
      {
        parentId:
          typeof body.parentId === "string" || body.parentId === null
            ? (body.parentId as string | null)
            : undefined,
        label: typeof body.label === "string" ? body.label : "",
        nodeKind: typeof body.nodeKind === "string" ? body.nodeKind : "",
        lineKey:
          typeof body.lineKey === "string" || body.lineKey === null
            ? (body.lineKey as string | null)
            : undefined,
        targetValue:
          typeof body.targetValue === "number" || body.targetValue === null
            ? (body.targetValue as number | null)
            : undefined,
        unit: typeof body.unit === "string" ? body.unit : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
      },
      gate.user.name
    );
    return ok({ node }, 201);
  } catch (err) {
    return serviceError(err, "node-create");
  }
}
