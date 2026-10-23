import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/comms/http";
import {
  deleteSchedule,
  getSchedule,
  pauseSchedule,
  resumeSchedule,
  updateSchedule,
} from "@/lib/comms/schedules";

/** GET one schedule by id. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const schedule = await getSchedule(params.id);
    if (!schedule) {
      return ok({ error: "schedule_not_found" }, 404);
    }
    return ok({ schedule });
  } catch (err) {
    return serviceError(err, "comms/schedules/get");
  }
}

/**
 * PATCH a schedule. Field edits go through updateSchedule; a status
 * change routes to the dedicated service functions — 'paused' →
 * pauseSchedule(id, reason), 'active' → resumeSchedule(id, actor) —
 * which own the pause_reason / next-run semantics.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const actor = gate.user.name || gate.user.email;
  try {
    const body = await readBody(req);
    const s = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    const status = s(body.status);
    const hasFieldEdits =
      body.templateId !== undefined ||
      body.subjectKind !== undefined ||
      body.subject_kind !== undefined ||
      body.companyId !== undefined ||
      body.company_id !== undefined ||
      body.dealId !== undefined ||
      body.deal_id !== undefined ||
      body.personId !== undefined ||
      body.person_id !== undefined ||
      body.cadence !== undefined ||
      body.dayOfMonth !== undefined ||
      body.day_of_month !== undefined ||
      body.recipients !== undefined;

    let schedule: unknown = null;
    if (hasFieldEdits) {
      schedule = await updateSchedule(
        params.id,
        {
          templateId: s(body.templateId) ?? s(body.template_id),
          subjectKind: s(body.subjectKind) ?? s(body.subject_kind),
          companyId: s(body.companyId) ?? s(body.company_id),
          dealId: s(body.dealId) ?? s(body.deal_id),
          personId: s(body.personId) ?? s(body.person_id),
          cadence: s(body.cadence),
          dayOfMonth:
            typeof body.dayOfMonth === "number"
              ? body.dayOfMonth
              : typeof body.day_of_month === "number"
                ? (body.day_of_month as number)
                : undefined,
          recipients: Array.isArray(body.recipients)
            ? (body.recipients as Parameters<typeof updateSchedule>[1]["recipients"])
            : undefined,
        },
        actor
      );
    }
    if (status === "paused") {
      schedule = await pauseSchedule(
        params.id,
        s(body.pauseReason) ?? s(body.pause_reason) ?? "Paused manually"
      );
    } else if (status === "active") {
      schedule = await resumeSchedule(params.id, actor);
    }
    if (!schedule) {
      // Status-only no-op or empty patch: still an update attempt —
      // delegate to updateSchedule with an empty input for validation.
      schedule = await updateSchedule(params.id, {}, actor);
    }
    return ok({ schedule });
  } catch (err) {
    return serviceError(err, "schedule-update");
  }
}

/** DELETE (soft) a schedule. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    await deleteSchedule(params.id, gate.user.name || gate.user.email);
    return ok({ deleted: true });
  } catch (err) {
    return serviceError(err, "schedule-delete");
  }
}
