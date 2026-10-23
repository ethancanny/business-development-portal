import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/comms/http";
import { createSchedule, listSchedules } from "@/lib/comms/schedules";

function scheduleInputFrom(body: Record<string, unknown>) {
  const s = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return {
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
    recipients: Array.isArray(body.recipients) ? body.recipients : undefined,
  };
}

/** GET schedule list. */
export async function GET(_req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const result = (await listSchedules()) as unknown;
    const items = Array.isArray(result)
      ? result
      : ((result as { items?: unknown[] })?.items ?? []);
    return ok({ items });
  } catch (err) {
    return serviceError(err, "schedules-list");
  }
}

/** POST create a schedule (starts unapproved — routine auto-send
 *  requires the one-time approve step). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const schedule = await createSchedule(
      scheduleInputFrom(body) as Parameters<typeof createSchedule>[0],
      gate.user.name || gate.user.email
    );
    return ok({ schedule });
  } catch (err) {
    return serviceError(err, "schedules-create");
  }
}
