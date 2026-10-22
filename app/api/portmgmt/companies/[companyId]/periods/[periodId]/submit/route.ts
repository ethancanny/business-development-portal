import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/portmgmt/http";
import { submitStatements } from "@/lib/portmgmt/submissions";

/** POST submit a statement package for the period. Body: { documentId } */
export async function POST(
  req: NextRequest,
  { params }: { params: { companyId: string; periodId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  const actor = gate.user.name || gate.user.email;
  try {
    const body = await readBody(req);
    const result = await submitStatements(
      params.companyId,
      params.periodId,
      sStr(body.documentId) ?? "",
      actor
    );
    return ok(result);
  } catch (err) {
    return serviceError(err, "period-submit");
  }
}
