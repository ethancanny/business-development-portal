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
import { listRisks, createRisk } from "@/lib/portmgmt/service";

export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  try {
    return ok({ risks: await listRisks(params.companyId) });
  } catch (err) {
    return serviceError(err, "risks-get");
  }
}

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
    const risk = await createRisk(
      params.companyId,
      {
        title: sStr(body.title),
        category: sStr(body.category),
        severity: sStr(body.severity),
        status: sStr(body.status),
        description: sStr(body.description),
        ownerName: sStr(body.ownerName) ?? sStr(body.owner_name),
        dueDate: sDate(body.dueDate) ?? sDate(body.due_date),
      },
      actor
    );
    return ok({ risk }, 201);
  } catch (err) {
    return serviceError(err, "risks-post");
  }
}
