import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import { createLink, listLinks } from "@/lib/valuecreation/service";

export async function GET(
  _req: NextRequest,
  { params }: { params: { initiativeId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const links = await listLinks(params.initiativeId);
    return ok({ links });
  } catch (err) {
    return serviceError(err, "links-list");
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
    const link = await createLink(
      params.initiativeId,
      {
        kind: typeof body.kind === "string" ? body.kind : undefined,
        refId:
          typeof body.refId === "string" || body.refId === null
            ? (body.refId as string | null)
            : undefined,
        label: typeof body.label === "string" ? body.label : undefined,
        url: typeof body.url === "string" ? body.url : undefined,
      },
      gate.user.name
    );
    return ok({ link });
  } catch (err) {
    return serviceError(err, "link-create");
  }
}
