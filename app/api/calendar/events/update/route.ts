import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { msConnected, updateGraphEvent, type EventDraft } from "@/lib/microsoft";

/** Update an event directly in Outlook via Graph (real-time path). */
export async function POST(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await msConnected())) {
    return NextResponse.json(
      { error: "Microsoft account not connected", code: "not_connected" },
      { status: 409 }
    );
  }
  const body = await req.json().catch(() => ({}));
  const eventId = String(body.eventId ?? "");
  const p = (body.payload ?? {}) as Record<string, unknown>;
  const draft: EventDraft = {
    title: String(p.title ?? "").trim(),
    startsAt: String(p.startsAt ?? ""),
    endsAt: String(p.endsAt ?? ""),
    location: String(p.location ?? ""),
  };
  if (!eventId || !draft.title || !draft.startsAt) {
    return NextResponse.json(
      { error: "eventId, title and startsAt required" },
      { status: 400 }
    );
  }
  try {
    await updateGraphEvent(eventId, draft);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
