import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/comms/http";
import { getDealSettings, setDealSettings } from "@/lib/comms/service";

/** GET per-deal comms settings (NDA restriction drives the pre-send
 *  check's nda_restricted block). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const settings = await getDealSettings(params.dealId);
    return ok({ settings });
  } catch (err) {
    return serviceError(err, "deal-settings-get");
  }
}

/** PUT per-deal comms settings { ndaRestricted, ndaNote }. */
export async function PUT(
  req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const settings = await setDealSettings(
      params.dealId,
      {
        ndaRestricted:
          typeof body.ndaRestricted === "boolean"
            ? body.ndaRestricted
            : typeof body.nda_restricted === "boolean"
              ? (body.nda_restricted as boolean)
              : undefined,
        ndaNote:
          typeof body.ndaNote === "string"
            ? body.ndaNote
            : typeof body.nda_note === "string"
              ? (body.nda_note as string)
              : undefined,
      } as Parameters<typeof setDealSettings>[1],
      gate.user.name || gate.user.email
    );
    return ok({ settings });
  } catch (err) {
    return serviceError(err, "deal-settings-put");
  }
}
