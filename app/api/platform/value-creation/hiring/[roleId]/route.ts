import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import {
  deleteHiringRole,
  updateHiringRole,
  type HiringRoleInput,
} from "@/lib/valuecreation/service";

const sStr = (v: unknown) => (typeof v === "string" ? v : undefined);
const sId = (v: unknown) =>
  typeof v === "string" || v === null ? (v as string | null) : undefined;

function hiringInputFrom(body: Record<string, unknown>): HiringRoleInput {
  return {
    role: sStr(body.role),
    department: sStr(body.department),
    priority: sStr(body.priority),
    targetDate: sId(body.targetDate),
    status: sStr(body.status),
    compRange: sStr(body.compRange),
    notes: sStr(body.notes),
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { roleId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const role = await updateHiringRole(
      params.roleId,
      hiringInputFrom(body),
      gate.user.name
    );
    return ok({ role });
  } catch (err) {
    return serviceError(err, "hiring-update");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { roleId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteHiringRole(params.roleId, gate.user.name);
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "hiring-delete");
  }
}
