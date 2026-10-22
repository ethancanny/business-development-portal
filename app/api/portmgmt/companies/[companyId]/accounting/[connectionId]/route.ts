import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/portmgmt/http";
import {
  getConnection,
  updateConnection,
  connectionStatus,
} from "@/lib/portmgmt/accounting";

/** PATCH a connection record (label / external id / notes). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { companyId: string; connectionId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  const actor = gate.user.name || gate.user.email;
  try {
    const existing = await getConnection(params.connectionId);
    if (!existing || existing.companyId !== params.companyId) {
      return serviceError(new Error("connection_not_found"), "accounting-patch");
    }
    const body = await readBody(req);
    const connection = await updateConnection(
      params.connectionId,
      {
        label: sStr(body.label),
        externalId: sStr(body.externalId) ?? sStr(body.external_id),
        notes: sStr(body.notes),
      },
      actor
    );
    return ok({
      connection: { ...connection, derivedStatus: connectionStatus(connection) },
    });
  } catch (err) {
    return serviceError(err, "accounting-patch");
  }
}
