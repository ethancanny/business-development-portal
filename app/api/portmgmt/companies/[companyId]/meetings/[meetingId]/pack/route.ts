import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  serviceError,
} from "@/lib/portmgmt/http";
import { generateMeetingPack } from "@/lib/portmgmt/service";

/** POST generate the meeting's board pack (stored as a document). */
export async function POST(
  _req: NextRequest,
  { params }: { params: { companyId: string; meetingId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  const actor = gate.user.name || gate.user.email;
  try {
    const meeting = await generateMeetingPack(
      params.companyId,
      params.meetingId,
      actor
    );
    return ok({ meeting });
  } catch (err) {
    return serviceError(err, "meeting-pack");
  }
}
