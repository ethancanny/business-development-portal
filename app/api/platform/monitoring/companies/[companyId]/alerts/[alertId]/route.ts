import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/monitoring/http";
import { updateAlertStatus } from "@/lib/monitoring/analytics";

/** PATCH an alert's status (ack / resolve / reopen) via WS-A's
 * setAlertStatus. Body: { status: 'acked'|'resolved'|'open' } or
 * { action: 'acknowledge'|'resolve'|'reopen' }. */
export async function PATCH(
  req: NextRequest,
  {
    params,
  }: { params: { companyId: string; alertId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const status = sStr(body.status) ?? sStr(body.action) ?? "";
    const alert = await updateAlertStatus(
      params.alertId,
      status,
      gate.user.name || gate.user.email
    );
    return ok({ alert });
  } catch (err) {
    return serviceError(err, "alert-patch");
  }
}
