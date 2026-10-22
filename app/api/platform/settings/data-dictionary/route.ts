import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getUserRole } from "@/lib/platform/permissions";
import { getDataDictionary } from "@/lib/platform/data-dictionary";

/**
 * Data dictionary feed (Settings → Data Dictionary). Session-gated;
 * roles admin OR internal may read it — guests get 403, no session
 * gets 401. The payload is cached server-side ~15 min in
 * lib/platform/data-dictionary.ts.
 */
export async function GET() {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const role = await getUserRole(user.email);
  if (role !== "admin" && role !== "internal") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const data = await getDataDictionary();
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
