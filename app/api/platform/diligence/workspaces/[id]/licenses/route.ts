import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  ok,
  readBody,
  serviceError,
  licenseInputFrom,
} from "@/lib/diligence/http";
import { createLicense, listLicenses } from "@/lib/diligence/service";

/** GET — the workspace's licenses & permits (per-tab load, redesign). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const licenses = await listLicenses(params.id);
    return ok({ licenses });
  } catch (err) {
    return serviceError(err, "licenses-list");
  }
}

/** POST — add a license to the tracker. */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const license = await createLicense(params.id, licenseInputFrom(body));
    return ok({ license }, 201);
  } catch (err) {
    return serviceError(err, "license-create");
  }
}
