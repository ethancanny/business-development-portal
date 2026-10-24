import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  ok,
  readBody,
  serviceError,
  contractInputFrom,
} from "@/lib/diligence/http";
import { createContract, listContracts } from "@/lib/diligence/service";

/** GET — the workspace's contract register (per-tab load, redesign). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const contracts = await listContracts(params.id);
    return ok({ contracts });
  } catch (err) {
    return serviceError(err, "contracts-list");
  }
}

/** POST — add a material contract to the register (manual entry). */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const contract = await createContract(params.id, contractInputFrom(body));
    return ok({ contract }, 201);
  } catch (err) {
    return serviceError(err, "contract-create");
  }
}
