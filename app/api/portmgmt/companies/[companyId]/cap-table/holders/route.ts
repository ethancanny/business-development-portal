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
import { createHolder } from "@/lib/portmgmt/service";

/** POST add a cap-table holder. Body: { name, personId?, units?, notes? } */
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
    const holder = await createHolder(
      params.companyId,
      {
        name: sStr(body.name),
        personId: sStr(body.personId) ?? sStr(body.person_id) ?? null,
        units: sNum(body.units),
        notes: sStr(body.notes),
      },
      actor
    );
    return ok({ holder }, 201);
  } catch (err) {
    return serviceError(err, "holders-post");
  }
}
