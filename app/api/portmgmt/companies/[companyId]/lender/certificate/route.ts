import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/portmgmt/http";
import { generateCertificate } from "@/lib/portmgmt/service";

/** POST generate a compliance certificate from the stored covenant
 * tests. Body: { periodEnd? } */
export async function POST(
  req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  const actor = gate.user.name || gate.user.email;
  try {
    const body = await readBody(req);
    const certificate = await generateCertificate(
      params.companyId,
      { periodEnd: sStr(body.periodEnd) ?? sStr(body.period_end) },
      actor
    );
    return ok({ certificate }, 201);
  } catch (err) {
    return serviceError(err, "lender-certificate");
  }
}
