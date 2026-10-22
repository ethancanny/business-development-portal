import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import {
  deleteAddon,
  updateAddon,
  type AddonInput,
} from "@/lib/valuecreation/service";

const sStr = (v: unknown) => (typeof v === "string" ? v : undefined);
const sId = (v: unknown) =>
  typeof v === "string" || v === null ? (v as string | null) : undefined;
const sNum = (v: unknown) =>
  typeof v === "number" || v === null ? (v as number | null) : undefined;

function addonInputFrom(body: Record<string, unknown>): AddonInput {
  return {
    targetCompanyId: sId(body.targetCompanyId),
    targetDealId: sId(body.targetDealId),
    name: sStr(body.name),
    status: sStr(body.status),
    synergyEstimate: sNum(body.synergyEstimate),
    revenueEstimate: sNum(body.revenueEstimate),
    ebitdaEstimate: sNum(body.ebitdaEstimate),
    notes: sStr(body.notes),
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { addonId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const addon = await updateAddon(
      params.addonId,
      addonInputFrom(body),
      gate.user.name
    );
    return ok({ addon });
  } catch (err) {
    return serviceError(err, "addon-update");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { addonId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteAddon(params.addonId, gate.user.name);
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "addon-delete");
  }
}
