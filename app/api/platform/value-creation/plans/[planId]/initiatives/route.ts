import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  initiativeInputFrom,
  ok,
  readBody,
  serviceError,
} from "@/lib/valuecreation/http";
import {
  createInitiative,
  listInitiatives,
} from "@/lib/valuecreation/service";

export async function GET(
  _req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const initiatives = await listInitiatives(params.planId);
    return ok({ initiatives });
  } catch (err) {
    return serviceError(err, "initiatives-list");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const initiative = await createInitiative(
      params.planId,
      initiativeInputFrom(body),
      gate.user.name
    );
    return ok({ initiative }, 201);
  } catch (err) {
    return serviceError(err, "initiative-create");
  }
}
