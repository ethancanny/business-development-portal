import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import { approveMemo } from "@/lib/diligence/memo";

/** POST /api/platform/diligence/memo/approve { id } — approve a memo. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return ok({ error: "memo_id_required" }, 400);
    const memo = await approveMemo(id, gate.user.name);
    return ok({ memo });
  } catch (err) {
    return serviceError(err, "memo-approve");
  }
}
