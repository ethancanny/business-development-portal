import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/portmgmt/http";
import { updateMeeting } from "@/lib/portmgmt/service";

/** PATCH a board meeting (status, minutes, decisions, agenda, attendees…). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { companyId: string; meetingId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  const actor = gate.user.name || gate.user.email;
  try {
    const body = await readBody(req);
    const meeting = await updateMeeting(
      params.companyId,
      params.meetingId,
      {
        title: sStr(body.title),
        startsAt:
          body.startsAt === null
            ? null
            : (sStr(body.startsAt) ?? sStr(body.starts_at)),
        endsAt:
          body.endsAt === null
            ? null
            : (sStr(body.endsAt) ?? sStr(body.ends_at)),
        status: sStr(body.status),
        agenda: sStr(body.agenda),
        minutes: sStr(body.minutes),
        decisions: sStr(body.decisions),
        attendees: Array.isArray(body.attendees) ? body.attendees : undefined,
      },
      actor
    );
    return ok({ meeting });
  } catch (err) {
    return serviceError(err, "meetings-patch");
  }
}
