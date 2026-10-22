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
