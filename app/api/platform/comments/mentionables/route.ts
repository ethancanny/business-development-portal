import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { listMentionables } from "@/lib/platform/collab";

export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const mentionables = await listMentionables();
  return NextResponse.json(
    { mentionables },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
