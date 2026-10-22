import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { findDocumentDuplicates } from "@/lib/dataroom/documents";

/** Library duplicate detection: identical bytes (SHA-256 groups) and
 * same-name/different-bytes probable duplicates. */
export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const result = await findDocumentDuplicates();
  return NextResponse.json(result);
}
