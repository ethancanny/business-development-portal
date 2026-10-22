import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  ok,
  readBody,
  serviceError,
  contractInputFrom,
} from "@/lib/diligence/http";
import { updateContract, deleteContract } from "@/lib/diligence/service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { cid: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const contract = await updateContract(params.cid, contractInputFrom(body));
    return ok({ contract });
  } catch (err) {
    return serviceError(err, "contract-update");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { cid: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteContract(params.cid);
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "contract-delete");
  }
}
