import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db-postgres";

interface Params {
  params: { id: string };
}

/** Hard-delete one registered listing (session only). Exists so junk or
 * test registrations can be removed from the dedup registry; mirrors the
 * deal-flow [id] DELETE. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  await ensureSchema();
  const db = neon(url);
  const rows = (await db`DELETE FROM mi_listings WHERE id = ${params.id} RETURNING id`) as unknown as Record<string, unknown>[];
  if (!rows.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
