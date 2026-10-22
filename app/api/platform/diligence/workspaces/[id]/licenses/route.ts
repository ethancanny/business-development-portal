import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  ok,
  readBody,
  serviceError,
  licenseInputFrom,
} from "@/lib/diligence/http";
import { createLicense } from "@/lib/diligence/service";

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
