import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import {
  updateSiteVisit,
  deleteSiteVisit,
  type SiteVisitInput,
} from "@/lib/diligence/service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { vid: string } }
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
    const visit = await updateSiteVisit(params.vid, input);
    return ok({ visit });
  } catch (err) {
    return serviceError(err, "site-visit-update");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { vid: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteSiteVisit(params.vid);
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "site-visit-delete");
  }
}
