import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/comms/http";
import { approveSchedule } from "@/lib/comms/schedules";

/** POST the one-time routine approval for a schedule. The service
 *  requires the template to be routine-eligible, else
 *  'routine_not_allowed'. */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const schedule = await approveSchedule(
      params.id,
      gate.user.name || gate.user.email
    );
    return ok({ schedule });
  } catch (err) {
    return serviceError(err, "schedule-approve");
  }
}
