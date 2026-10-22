import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
  sNum,
} from "@/lib/portmgmt/http";
import { beginPortalUpload } from "@/lib/portmgmt/submissions";

/** POST begin a chunked portal upload.
 * Body: { filename, mime?, totalSize, companyId, tags?, note? } —
 * the company is gated against the caller's access context. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const actor = gate.user.name || gate.user.email;
  try {
    const body = await readBody(req);
    const companyId = sStr(body.companyId) ?? sStr(body.company_id) ?? "";
    const denied = companyGate(gate.ctx, companyId);
    if (denied) return denied;
    const totalSize = sNum(body.totalSize);
    const session = await beginPortalUpload(
      {
        filename: sStr(body.filename) ?? "",
        mime: sStr(body.mime),
        totalSize: typeof totalSize === "number" ? totalSize : 0,
        companyId,
        tags: Array.isArray(body.tags)
          ? body.tags.map((x) => String(x))
          : undefined,
        note: sStr(body.note),
      },
      actor
    );
    return ok({ session }, 201);
  } catch (err) {
    return serviceError(err, "uploads-begin");
  }
}
