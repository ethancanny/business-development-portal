import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
  sDate,
} from "@/lib/portmgmt/http";
import { updateRisk, deleteRisk } from "@/lib/portmgmt/service";

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
    const risk = await updateRisk(
      params.companyId,
      params.id,
      {
        title: sStr(body.title),
        category: sStr(body.category),
        severity: sStr(body.severity),
        status: sStr(body.status),
        description: sStr(body.description),
        ownerName: sStr(body.ownerName) ?? sStr(body.owner_name),
        dueDate:
          body.dueDate === null || body.due_date === null
            ? null
            : (sDate(body.dueDate) ?? sDate(body.due_date)),
      },
      actor
    );
    return ok({ risk });
  } catch (err) {
    return serviceError(err, "risks-patch");
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
    const deleted = await deleteRisk(params.companyId, params.id, actor);
    if (!deleted) {
      return serviceError(new Error("risk_not_found"), "risks-delete");
    }
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "risks-delete");
  }
}
