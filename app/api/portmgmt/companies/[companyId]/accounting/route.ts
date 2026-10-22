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
  listConnections,
  createConnection,
  connectionStatus,
  providerCatalog,
} from "@/lib/portmgmt/accounting";

/** GET the company's accounting connections (with derived honest
 * status) + the provider catalog with setup steps / missing config. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  try {
    const connections = (await listConnections(params.companyId)).map(
      (c) => ({ ...c, derivedStatus: connectionStatus(c) })
    );
    return ok({ connections, providers: providerCatalog() });
  } catch (err) {
    return serviceError(err, "accounting-get");
  }
}

/** POST create a connection record. Body: { provider, label?,
 * externalId?, notes? } — creating the record does NOT connect
 * anything; status stays setup_required / not_connected per config. */
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
    const connection = await createConnection(
      params.companyId,
      {
        provider: sStr(body.provider) ?? "",
        label: sStr(body.label),
        externalId: sStr(body.externalId) ?? sStr(body.external_id),
        notes: sStr(body.notes),
      },
      actor
    );
    return ok(
      { connection: { ...connection, derivedStatus: connectionStatus(connection) } },
      201
    );
  } catch (err) {
    return serviceError(err, "accounting-post");
  }
}
