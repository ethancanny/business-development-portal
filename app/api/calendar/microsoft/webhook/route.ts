import { NextRequest, NextResponse } from "next/server";
import { getClientState, pullGraphWindow } from "@/lib/microsoft";

/**
 * Microsoft Graph change notifications for /me/events. Handles the
 * subscription validation handshake, verifies the clientState secret, then
 * pulls the window (idempotent) and cross-logs genuinely new events.
 * Notifications about deleted events arrive without resource data we can
 * fetch — the window pull's prune handles those.
 */
export async function POST(req: NextRequest) {
  const validationToken = req.nextUrl.searchParams.get("validationToken");
  if (validationToken) {
    return new NextResponse(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  const body = (await req.json().catch(() => ({}))) as {
    value?: { clientState?: string }[];
  };
  const expected = await getClientState();
  const notes = Array.isArray(body.value) ? body.value : [];
  const trusted = notes.length > 0 && notes.every((n) => n.clientState === expected);
  if (!trusted) {
    return NextResponse.json({ error: "untrusted notification" }, { status: 401 });
  }
  try {
    await pullGraphWindow();
  } catch {
    /* the watchdog's catch-up pull will self-heal */
  }
  // Event-driven push (Oct 21, 2026): a change notification means
  // calendar state just changed — (re)schedule push jobs for upcoming
  // events and drain any due jobs while we're here. Best-effort.
  try {
    const { scheduleUpcomingEventPushJobs, drainPushJobs } = await import(
      "@/lib/push-schedule"
    );
    await scheduleUpcomingEventPushJobs();
    await drainPushJobs();
  } catch {
    /* best-effort */
  }
  return NextResponse.json({ ok: true }, { status: 202 });
}
