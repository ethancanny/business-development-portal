import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import { listTrees, createTree, createMarginTemplateTree } from "@/lib/valuecreation/trees";

/** GET — tree list for the plan (node counts only, no deep payload). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const trees = await listTrees(params.planId);
    return ok({ trees });
  } catch (err) {
    return serviceError(err, "trees-list");
  }
}

/**
 * POST — create a tree: { name } for a blank tree, or
 * { template: "margin" } for the seeded margin-improvement tree.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    if (body.template === "margin") {
      const result = await createMarginTemplateTree(params.planId, gate.user.name);
      return ok(result, 201);
    }
    const tree = await createTree(
      params.planId,
      { name: typeof body.name === "string" ? body.name : "" },
      gate.user.name
    );
    return ok({ tree }, 201);
  } catch (err) {
    return serviceError(err, "trees-create");
  }
}
