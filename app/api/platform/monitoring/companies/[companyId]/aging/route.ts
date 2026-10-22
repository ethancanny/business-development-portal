import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
  sNum,
} from "@/lib/monitoring/http";
import { getAging, createAgingSnapshot } from "@/lib/monitoring/analytics";

/** GET the latest AR and AP aging snapshots (with bucket totals). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const forbidden = companyGate(gate.ctx, params.companyId);
  if (forbidden) return forbidden;
  try {
    return ok(await getAging(params.companyId));
  } catch (err) {
    return serviceError(err, "aging-get");
  }
}

/** POST record an aging snapshot. Body: { asOf, kind: 'ar'|'ap',
 * currentAmt, d31_60, d61_90, d90Plus, source: 'manual'|'upload',
 * documentId, notes } (snake_case bucket names also accepted). */
export async function POST(
  req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const forbidden = companyGate(gate.ctx, params.companyId);
  if (forbidden) return forbidden;
  try {
    const body = await readBody(req);
    const pick = (...keys: string[]): number | null => {
      for (const k of keys) {
        const v = sNum(body[k]);
        if (v !== undefined) return v;
      }
      return null;
    };
    const snapshot = await createAgingSnapshot(
      params.companyId,
      {
        asOf: sStr(body.asOf) ?? sStr(body.as_of) ?? "",
        kind: sStr(body.kind) ?? "",
        currentAmt: pick("currentAmt", "current_amt", "current"),
        d31_60: pick("d31_60", "d31To60"),
        d61_90: pick("d61_90", "d61To90"),
        d90Plus: pick("d90Plus", "d90_plus", "d90"),
        source: sStr(body.source),
        documentId: sStr(body.documentId) ?? sStr(body.document_id) ?? null,
        notes: sStr(body.notes),
      },
      gate.user.name || gate.user.email
    );
    return ok({ snapshot }, 201);
  } catch (err) {
    return serviceError(err, "aging-post");
  }
}
