import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { deleteGraphEvent, msConnected } from "@/lib/microsoft";

/** Delete an event directly in Outlook via Graph (real-time path). */
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
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }
  try {
    await deleteGraphEvent(eventId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
