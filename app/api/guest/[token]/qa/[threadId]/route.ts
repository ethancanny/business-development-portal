import { NextRequest, NextResponse } from "next/server";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { validateGuestToken } from "@/lib/dataroom/guests";
import { replyToThread } from "@/lib/dataroom/qa";

/** Guest follow-up on a Q&A thread in their room. */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string; threadId: string } }
) {
  await ensureDataRoom();
  const v = await validateGuestToken(params.token);
  if (!v.ok) {
    const status =
      v.reason === "expired" ? 410 : v.reason === "not_found" ? 404 : 403;
    return NextResponse.json({ error: v.reason }, { status });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const thread = await replyToThread(
      v.room.id,
      params.threadId,
      typeof body.body === "string" ? body.body : "",
      v.guest.name || v.guest.email,
      "guest"
    );
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    return NextResponse.json({ thread });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
