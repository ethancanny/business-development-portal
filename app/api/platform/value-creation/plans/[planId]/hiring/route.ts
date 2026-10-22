import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import {
  createHiringRole,
  listHiringRoles,
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

export async function GET(
  _req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const roles = await listHiringRoles(params.planId);
    return ok({ roles });
  } catch (err) {
    return serviceError(err, "hiring-list");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const role = await createHiringRole(
      params.planId,
      hiringInputFrom(body),
      gate.user.name
    );
    return ok({ role }, 201);
  } catch (err) {
    return serviceError(err, "hiring-create");
  }
}
