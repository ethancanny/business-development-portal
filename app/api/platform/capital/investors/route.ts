import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  ok,
  readBody,
  serviceError,
  sStr,
  sNum,
  sDate,
  sStrArr,
} from "@/lib/capital/http";
import {
  createInvestor,
  listInvestors,
  type InvestorProfileInput,
} from "@/lib/capital/service";
import { getAccessContext } from "@/lib/platform/permissions";

/** checkByType body field: { [typeKey]: { min, max } } sanitized. */
function sCheckByType(
  v: unknown
): Record<string, { min: number | null; max: number | null }> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, { min: number | null; max: number | null }> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const r =
      val && typeof val === "object"
        ? (val as Record<string, unknown>)
        : {};
    out[k] = {
      min: typeof r.min === "number" ? r.min : null,
      max: typeof r.max === "number" ? r.max : null,
    };
  }
  return out;
}

function profileInputFrom(
  body: Record<string, unknown>
): InvestorProfileInput {
  return {
    investorType: sStr(body.investorType),
    status: sStr(body.status),
    introSource: sStr(body.introSource),
    lastTouchAt: sDate(body.lastTouchAt),
    thesisSectors: sStrArr(body.thesisSectors),
    dealSizeMin: sNum(body.dealSizeMin),
    dealSizeMax: sNum(body.dealSizeMax),
    checkSizeMin: sNum(body.checkSizeMin),
    checkSizeMax: sNum(body.checkSizeMax),
    structurePrefs: sStr(body.structurePrefs),
    notes: sStr(body.notes),
    source: sStr(body.source),
    geography: sStr(body.geography),
    accreditedStatus: sStr(body.accreditedStatus),
    relationshipOwner: sStr(body.relationshipOwner),
    investsInTypes: sStrArr(body.investsInTypes),
    checkByType: sCheckByType(body.checkByType),
  };
}

/** GET investor list (Directory people tagged investor/lp + profiles). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  // Phase 9: investor data is internal-only.
  const ctx = await getAccessContext(gate.user);
  if (ctx.companyIds !== null) {
    return NextResponse.json(
      { error: "internal_only" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  try {
    const sp = req.nextUrl.searchParams;
    const limitRaw = Number(sp.get("limit") ?? 25);
    const offsetRaw = Number(sp.get("offset") ?? 0);
    const result = await listInvestors({
      q: sp.get("q") ?? undefined,
      status: sp.get("status") ?? undefined,
      limit: isFinite(limitRaw) ? limitRaw : 25,
      offset: isFinite(offsetRaw) ? offsetRaw : 0,
    });
    return ok(result);
  } catch (err) {
    return serviceError(err, "investors-list");
  }
}

/** POST create a new investor (Directory person + capital profile). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const result = await createInvestor(
      {
        name: sStr(body.name) ?? "",
        title: sStr(body.title),
        email: sStr(body.email),
        phone: sStr(body.phone),
        organizationName: sStr(body.organizationName) ?? sStr(body.firm),
        ...profileInputFrom(body),
      },
      gate.user.name || gate.user.email
    );
    return ok(result, 201);
  } catch (err) {
    return serviceError(err, "investor-create");
  }
}
