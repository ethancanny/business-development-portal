import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getUnifiedTasks } from "@/lib/platform/collab";

export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const items = await getUnifiedTasks();
  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
