import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { replyToThread, setThreadStatus } from "@/lib/dataroom/qa";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; threadId: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const thread = await replyToThread(
      params.id,
      params.threadId,
      typeof body.body === "string" ? body.body : "",
      user.name || user.email,
      "internal"
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; threadId: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const thread = await setThreadStatus(
      params.id,
      params.threadId,
      typeof body.status === "string" ? body.status : "",
      user.name || user.email
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
