import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
  sNum,
  sDate,
} from "@/lib/monitoring/http";
import {
  getCovenants,
  createCovenant,
  updateCovenant,
  type CovenantInput,
} from "@/lib/monitoring/analytics";

function covenantInputFrom(
  body: Record<string, unknown>
): CovenantInput {
  return {
    trancheId: sDate(body.trancheId),
    covenantKey: sStr(body.covenantKey) ?? sStr(body.covenant_key),
    label: sStr(body.label),
    operator: sStr(body.operator),
    threshold: sNum(body.threshold),
    nextTestDate: sDate(body.nextTestDate),
    active: typeof body.active === "boolean" ? body.active : undefined,
  };
}

/** GET covenant definitions with each covenant's latest test. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const forbidden = companyGate(gate.ctx, params.companyId);
  if (forbidden) return forbidden;
  try {
    return ok(await getCovenants(params.companyId));
  } catch (err) {
    return serviceError(err, "covenants-get");
  }
}

/** POST create a covenant definition — or update one when the body
 * carries an `id` (definitions are updated through the same route;
 * there is no separate [covenantId] route in the Phase 8 contract). */
export async function POST(
  req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const forbidden = companyGate(gate.ctx, params.companyId);
  if (forbidden) return forbidden;
  const actor = gate.user.name || gate.user.email;
  try {
    const body = await readBody(req);
    const id = sStr(body.id);
    if (id) {
      const covenant = await updateCovenant(
        params.companyId,
        id,
        covenantInputFrom(body),
        actor
      );
      return ok({ covenant });
    }
    const covenant = await createCovenant(
      params.companyId,
      covenantInputFrom(body),
      actor
    );
    return ok({ covenant }, 201);
  } catch (err) {
    return serviceError(err, "covenants-post");
  }
}
