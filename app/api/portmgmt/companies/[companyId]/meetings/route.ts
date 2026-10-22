import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/portmgmt/http";
import { listMeetings, createMeeting } from "@/lib/portmgmt/service";

export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  try {
    return ok({ meetings: await listMeetings(params.companyId) });
  } catch (err) {
    return serviceError(err, "meetings-get");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  const actor = gate.user.name || gate.user.email;
  try {
    const body = await readBody(req);
    const meeting = await createMeeting(
      params.companyId,
      {
        title: sStr(body.title),
        startsAt: sStr(body.startsAt) ?? sStr(body.starts_at) ?? null,
        endsAt: sStr(body.endsAt) ?? sStr(body.ends_at) ?? null,
        status: sStr(body.status),
        agenda: sStr(body.agenda),
        attendees: Array.isArray(body.attendees) ? body.attendees : undefined,
      },
      actor
    );
    return ok({ meeting }, 201);
  } catch (err) {
    return serviceError(err, "meetings-post");
  }
}
