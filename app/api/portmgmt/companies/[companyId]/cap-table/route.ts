import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  serviceError,
} from "@/lib/portmgmt/http";
import { getCapTable } from "@/lib/portmgmt/service";

/** GET the cap table: holders with ownership %, total units,
 * distributions, and the linked deal's capital report totals. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  try {
    return ok(await getCapTable(params.companyId));
  } catch (err) {
    return serviceError(err, "cap-table-get");
  }
}
