import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { validateGuestToken } from "@/lib/dataroom/guests";
import { createThread, listThreads } from "@/lib/dataroom/qa";

/** Guest responses carry access decisions — they must never be stored
 * by any cache layer. (A cached 200 kept revoked links working in
 * production even with force-dynamic set; no-store ends that class.) */
function jsonNoStore(body: unknown, init?: { status?: number }): NextResponse {
  const res = NextResponse.json(body, init ?? {});
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}


// NEVER cache guest responses (see ../route.ts): token validity is
// re-checked against the database on every call.
export const dynamic = "force-dynamic";

/** Guest Q&A: list the room's threads, or ask a new question. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  // Per-request dynamic execution (see ../route.ts).
  headers();
  await ensureDataRoom();
  const v = await validateGuestToken(params.token);
  if (!v.ok) {
    const status =
      v.reason === "expired" ? 410 : v.reason === "not_found" ? 404 : 403;
    return jsonNoStore({ error: v.reason }, { status });
  }
  const threads = await listThreads(v.room.id);
  return jsonNoStore({ threads });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
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
    const thread = await createThread(
      v.room.id,
      {
        title: typeof body.title === "string" ? body.title : "",
        body: typeof body.body === "string" ? body.body : "",
        documentId:
          typeof body.documentId === "string" ? body.documentId : null,
      },
      v.guest.name || v.guest.email,
      "guest"
    );
    return jsonNoStore({ thread }, { status: 201 });
  } catch (err) {
    return jsonNoStore(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
