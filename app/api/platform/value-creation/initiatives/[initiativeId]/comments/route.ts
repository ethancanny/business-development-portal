import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import { createComment, listComments } from "@/lib/valuecreation/service";

export async function GET(
  _req: NextRequest,
  { params }: { params: { initiativeId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const comments = await listComments(params.initiativeId);
    return ok({ comments });
  } catch (err) {
    return serviceError(err, "comments-list");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { initiativeId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const comment = await createComment(
      params.initiativeId,
      { body: typeof body.body === "string" ? body.body : undefined },
      gate.user.name
    );
    return ok({ comment });
  } catch (err) {
    return serviceError(err, "comment-create");
  }
}
