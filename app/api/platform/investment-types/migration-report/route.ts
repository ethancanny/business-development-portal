import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getLatestMigrationReport } from "@/lib/bd/migrate";

/** Step 1 migration report (spec item 10): deals scanned, per-type
 * counts, per-stage from→to counts, and anything unmapped — written
 * server-side by the migration itself (lib/bd/migrate.ts). The
 * migration runs on the first authenticated platform boot after the
 * deploy, so before that this returns { ran: false }. Ethan verifies
 * by opening this URL while signed in. */
export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const data = await getLatestMigrationReport();
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
