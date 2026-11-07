import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getRetentionStatus, runRetentionPurge } from "@/lib/retention";

/**
 * Data retention & hygiene (Nov 7, 2026).
 * GET  /api/admin/retention — what a purge would remove right now.
 * POST /api/admin/retention — run the purge; returns exact counts.
 * Session-gated (middleware + explicit check, same as other routes).
 */
export async function GET() {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await getRetentionStatus());
}

export async function POST() {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runRetentionPurge();
  return NextResponse.json(result);
}
