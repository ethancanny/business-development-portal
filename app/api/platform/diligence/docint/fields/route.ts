import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/diligence/http";
import { listFields } from "@/lib/docint/service";

/**
 * GET ?dealId=&documentId=&status= — extracted fields, ordered by
 * document, FIELD_DEFS order, then creation time.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const sp = req.nextUrl.searchParams;
    const fields = await listFields({
      dealId: sp.get("dealId") ?? undefined,
      documentId: sp.get("documentId") ?? undefined,
      status: sp.get("status") ?? undefined,
    });
    return ok({ fields });
  } catch (err) {
    return serviceError(err, "docint-fields");
  }
}
