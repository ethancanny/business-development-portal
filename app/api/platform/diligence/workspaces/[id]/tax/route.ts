import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import { getTaxProfile, updateTaxProfile } from "@/lib/diligence/service";

/**
 * GET — tax profile; the read recomputes missing return years live
 * from the data room (Tax folder evidence) and persists the verdict.
 * PUT — update entity type, elections, nexus, exposures, NOLs,
 * credits, R&D credits and the 338(h)(10) checklist.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const result = await getTaxProfile(params.id);
    return ok(result);
  } catch (err) {
    return serviceError(err, "tax-get");
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const s = (v: unknown) => (typeof v === "string" ? v : undefined);
    const arr = (v: unknown) =>
      Array.isArray(v) ? (v as string[]) : undefined;
    const profile = await updateTaxProfile(params.id, {
      entityType: s(body.entityType),
      elections: arr(body.elections),
      nexusStates: arr(body.nexusStates),
      salesTaxExposure: s(body.salesTaxExposure),
      nolAmount:
        typeof body.nolAmount === "number" || body.nolAmount === null
          ? (body.nolAmount as number | null)
          : undefined,
      nolNotes: s(body.nolNotes),
      credits: s(body.credits),
      rdCredits: s(body.rdCredits),
      section338:
        body.section338 && typeof body.section338 === "object"
          ? (body.section338 as Record<string, boolean>)
          : undefined,
      notes: s(body.notes),
    });
    return ok({ profile });
  } catch (err) {
    return serviceError(err, "tax-update");
  }
}
