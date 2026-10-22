import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import { createRedFlag, listRedFlags } from "@/lib/diligence/service";

/** GET — red flag register (incl. unconfirmed analysis candidates). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const flags = await listRedFlags(params.id);
    return ok({ flags });
  } catch (err) {
    return serviceError(err, "red-flags-list");
  }
}

/** POST — add a manual red flag (starts 'open'). */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const s = (v: unknown) => (typeof v === "string" ? v : undefined);
    const flag = await createRedFlag(params.id, {
      title: s(body.title) ?? "",
      detail: s(body.detail),
      severity: s(body.severity),
      owner: s(body.owner),
      mitigation: s(body.mitigation),
    });
    return ok({ flag }, 201);
  } catch (err) {
    return serviceError(err, "red-flag-create");
  }
}
