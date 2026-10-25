import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/comms/http";
import {
  getReportContactSettings,
  setReportContactSettings,
} from "@/lib/comms/service";

/**
 * Report delivery settings (Report redesign, Oct 24, 2026): the
 * sender name/email/phone shown in delivered reports' contact block
 * and the optional scheduling link behind "Request a call". When no
 * scheduling link is configured, recipient pages omit the option —
 * a URL is never invented.
 */
export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    return ok({ settings: await getReportContactSettings() });
  } catch (err) {
    return serviceError(err, "report-settings:get");
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const settings = await setReportContactSettings({
      senderName: typeof body.senderName === "string" ? body.senderName : "",
      senderEmail: typeof body.senderEmail === "string" ? body.senderEmail : "",
      senderPhone: typeof body.senderPhone === "string" ? body.senderPhone : "",
      schedulingUrl:
        typeof body.schedulingUrl === "string" ? body.schedulingUrl : "",
    });
    return ok({ settings });
  } catch (err) {
    return serviceError(err, "report-settings:put");
  }
}
