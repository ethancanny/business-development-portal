import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  ok,
  readBody,
  serviceError,
  sStr,
  sDate,
} from "@/lib/capital/http";
import {
  getDealReporting,
  createReportEntry,
} from "@/lib/capital/reporting";

/**
 * Investor reporting entries for a deal.
 * GET  — {entries (≤200, as_of desc, investorName resolved), totals}
 * POST — create {entryType, investorPersonId?, amount, asOf?, notes?}
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    return ok(await getDealReporting(params.dealId));
  } catch (err) {
    return serviceError(err, "reporting-get");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const entry = await createReportEntry(
      params.dealId,
      {
        entryType: sStr(body.entryType ?? body.entry_type),
        investorPersonId: sStr(
          body.investorPersonId ?? body.investor_person_id
        ),
        amount:
          typeof body.amount === "number" ? body.amount : undefined,
        asOf: sDate(body.asOf ?? body.as_of),
        notes: sStr(body.notes),
        source: sStr(body.source),
      },
      gate.user.name
    );
    return ok({ entry }, 201);
  } catch (err) {
    return serviceError(err, "reporting-post");
  }
}
