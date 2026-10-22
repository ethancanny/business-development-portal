import { NextRequest, NextResponse } from "next/server";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { validateGuestToken } from "@/lib/dataroom/guests";
import { replyToThread } from "@/lib/dataroom/qa";

/** Guest responses carry access decisions — they must never be stored
 * by any cache layer. (A cached 200 kept revoked links working in
 * production even with force-dynamic set; no-store ends that class.) */
function jsonNoStore(body: unknown, init?: { status?: number }): NextResponse {
  const res = NextResponse.json(body, init ?? {});
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}


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
    return jsonNoStore({ error: v.reason }, { status });
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
      return jsonNoStore({ error: "Thread not found" }, { status: 404 });
    }
    return jsonNoStore({ thread });
  } catch (err) {
    return jsonNoStore(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
