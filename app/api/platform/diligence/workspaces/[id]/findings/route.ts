import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import { createFinding } from "@/lib/diligence/service";

/** POST — record a finding with a proposed deal-term consequence. */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const s = (v: unknown) => (typeof v === "string" ? v : undefined);
    const finding = await createFinding(
      params.id,
      {
        title: s(body.title) ?? "",
        detail: s(body.detail),
        category: s(body.category),
        severity: s(body.severity),
        proposedTermType: s(body.proposedTermType),
        proposedTermDetail: s(body.proposedTermDetail),
        redFlagId:
          typeof body.redFlagId === "string" ? body.redFlagId : null,
      },
      gate.user.name
    );
    return ok({ finding }, 201);
  } catch (err) {
    return serviceError(err, "finding-create");
  }
}
