import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import {
  deleteOrgNode,
  updateOrgNode,
  type OrgNodeInput,
} from "@/lib/valuecreation/service";

const sStr = (v: unknown) => (typeof v === "string" ? v : undefined);
const sId = (v: unknown) =>
  typeof v === "string" || v === null ? (v as string | null) : undefined;
const sBool = (v: unknown) => (typeof v === "boolean" ? v : undefined);

function orgInputFrom(body: Record<string, unknown>): OrgNodeInput {
  return {
    personId: sId(body.personId),
    name: sStr(body.name),
    title: sStr(body.title),
    reportsToId: sId(body.reportsToId),
    isKeyPerson: sBool(body.isKeyPerson),
    riskLevel: sStr(body.riskLevel),
    riskNotes: sStr(body.riskNotes),
    incentiveNotes: sStr(body.incentiveNotes),
    vacancy: sBool(body.vacancy),
    targetDate: sId(body.targetDate),
    sort: typeof body.sort === "number" ? body.sort : undefined,
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { nodeId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const node = await updateOrgNode(
      params.nodeId,
      orgInputFrom(body),
      gate.user.name
    );
    return ok({ node });
  } catch (err) {
    return serviceError(err, "org-update");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { nodeId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteOrgNode(params.nodeId, gate.user.name);
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "org-delete");
  }
}
