import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getEsignStatus } from "@/lib/docgen/esign";

/** In-house signing status: provider state + certificate info +
 * live-flow setup steps (lib/docgen/esign.getEsignStatus). */
export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const status = await getEsignStatus();
  return NextResponse.json(status);
}
