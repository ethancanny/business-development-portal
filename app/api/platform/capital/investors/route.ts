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

/** GET investor list (Directory people tagged investor/lp + profiles). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
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
