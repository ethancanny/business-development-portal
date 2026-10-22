import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  serviceError,
} from "@/lib/portmgmt/http";
import { deleteValuation } from "@/lib/portmgmt/service";

/** DELETE (soft) a valuation. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { companyId: string; id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  const actor = gate.user.name || gate.user.email;
  try {
    const deleted = await deleteValuation(params.companyId, params.id, actor);
    if (!deleted) {
      return serviceError(new Error("valuation_not_found"), "valuations-delete");
    }
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "valuations-delete");
  }
}
