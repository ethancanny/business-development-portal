import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  ok,
  readBody,
  serviceError,
  licenseInputFrom,
} from "@/lib/diligence/http";
import { updateLicense, deleteLicense } from "@/lib/diligence/service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { lid: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const license = await updateLicense(params.lid, licenseInputFrom(body));
    return ok({ license });
  } catch (err) {
    return serviceError(err, "license-update");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { lid: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteLicense(params.lid);
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "license-delete");
  }
}
