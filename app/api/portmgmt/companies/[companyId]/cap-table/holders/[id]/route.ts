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
import { updateHolder, deleteHolder } from "@/lib/portmgmt/service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { companyId: string; id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  const actor = gate.user.name || gate.user.email;
  try {
    const body = await readBody(req);
    const holder = await updateHolder(
      params.companyId,
      params.id,
      {
        name: sStr(body.name),
        personId:
          body.personId === null || body.person_id === null
            ? null
            : (sStr(body.personId) ?? sStr(body.person_id)),
        units: sNum(body.units),
        notes: sStr(body.notes),
      },
      actor
    );
    return ok({ holder });
  } catch (err) {
    return serviceError(err, "holders-patch");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { companyId: string; id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  const actor = gate.user.name || gate.user.email;
  try {
    const deleted = await deleteHolder(params.companyId, params.id, actor);
    if (!deleted) {
      return serviceError(new Error("holder_not_found"), "holders-delete");
    }
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "holders-delete");
  }
}
