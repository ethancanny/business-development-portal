import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import {
  createSiteVisit,
  listSiteVisits,
  type SiteVisitInput,
} from "@/lib/diligence/service";

/** GET — the workspace's site visits (per-tab load, redesign). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const visits = await listSiteVisits(params.id);
    return ok({ visits });
  } catch (err) {
    return serviceError(err, "site-visits-list");
  }
}

/**
 * POST — record a site visit. Photos are core.documents ids only
 * (uploaded through the data room / documents storage); bytes never
 * enter the database.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const input: SiteVisitInput = {
      visitDate:
        typeof body.visitDate === "string" || body.visitDate === null
          ? (body.visitDate as string | null)
          : undefined,
      attendees: Array.isArray(body.attendees)
        ? (body.attendees as string[])
        : undefined,
      observations:
        typeof body.observations === "string" ? body.observations : undefined,
      photoDocumentIds: Array.isArray(body.photoDocumentIds)
        ? (body.photoDocumentIds as string[])
        : undefined,
      facilityConditionScore:
        typeof body.facilityConditionScore === "number" ||
        body.facilityConditionScore === null
          ? (body.facilityConditionScore as number | null)
          : undefined,
      capacityNotes:
        typeof body.capacityNotes === "string"
          ? body.capacityNotes
          : undefined,
      utilizationEstimate:
        typeof body.utilizationEstimate === "string"
          ? body.utilizationEstimate
          : undefined,
    };
    const visit = await createSiteVisit(params.id, input, gate.user.name);
    return ok({ visit }, 201);
  } catch (err) {
    return serviceError(err, "site-visit-create");
  }
}
