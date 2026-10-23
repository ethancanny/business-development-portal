import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/comms/http";
import { revokeDelivery } from "@/lib/comms/delivery";

/** POST revoke one delivery — effective immediately: the recipient
 *  token stops validating on its very next call. */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; deliveryId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const delivery = await revokeDelivery(
      params.deliveryId,
      gate.user.name || gate.user.email
    );
    return ok({ delivery, reportId: params.id });
  } catch (err) {
    return serviceError(err, "delivery-revoke");
  }
}
