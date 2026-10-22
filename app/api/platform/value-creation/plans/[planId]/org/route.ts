import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import {
  createOrgNode,
  listOrgNodes,
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

export async function GET(
  _req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const nodes = await listOrgNodes(params.planId);
    return ok({ nodes });
  } catch (err) {
    return serviceError(err, "org-list");
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
    const node = await createOrgNode(
      params.planId,
      orgInputFrom(body),
      gate.user.name
    );
    return ok({ node }, 201);
  } catch (err) {
    return serviceError(err, "org-create");
  }
}
