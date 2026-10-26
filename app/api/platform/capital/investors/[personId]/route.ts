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
  getInvestorDetail,
  updateInvestorProfile,
  type InvestorProfileInput,
} from "@/lib/capital/service";

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

/** GET investor detail: Directory record + profile + commitments +
 *  report totals + investor activity. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { personId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const detail = await getInvestorDetail(params.personId);
    return ok(detail);
  } catch (err) {
    return serviceError(err, "investor-detail");
  }
}

/** PUT the capital profile for an existing Directory person. */
export async function PUT(
  req: NextRequest,
  { params }: { params: { personId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const profile = await updateInvestorProfile(
      params.personId,
      profileInputFrom(body),
      gate.user.name || gate.user.email
    );
    return ok({ profile });
  } catch (err) {
    return serviceError(err, "investor-profile-update");
  }
}
