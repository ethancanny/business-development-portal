import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  ok,
  readBody,
  serviceError,
  sStr,
  sNum,
} from "@/lib/capital/http";
import {
  createRaise,
  deleteRaise,
  getRaiseBundle,
  updateRaise,
} from "@/lib/capital/service";

/** GET the deal's raise bundle: { raise (may be null), summary, commitments }. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const bundle = await getRaiseBundle(params.dealId);
    return ok(bundle);
  } catch (err) {
    return serviceError(err, "raise-get");
  }
}

/** POST create the deal's open raise (409 raise_exists when one is live). */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const target = sNum(body.targetRaise);
    const raise = await createRaise(
      params.dealId,
      {
        targetRaise: target === null ? undefined : target,
        notes: sStr(body.notes),
      },
      gate.user.name || gate.user.email
    );
    return ok({ raise }, 201);
  } catch (err) {
    return serviceError(err, "raise-create");
  }
}

/** PATCH the deal's open raise (targetRaise / status / notes). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const target = sNum(body.targetRaise);
    const raise = await updateRaise(
      params.dealId,
      {
        targetRaise: target === null ? undefined : target,
        status: sStr(body.status),
        notes: sStr(body.notes),
      },
      gate.user.name || gate.user.email
    );
    return ok({ raise });
  } catch (err) {
    return serviceError(err, "raise-update");
  }
}

/** DELETE soft-deletes the deal's open raise. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteRaise(
      params.dealId,
      gate.user.name || gate.user.email
    );
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "raise-delete");
  }
}
