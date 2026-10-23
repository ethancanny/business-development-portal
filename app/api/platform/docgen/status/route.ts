import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getEsignStatus } from "@/lib/docgen/esign";
import { countTemplates } from "@/lib/docgen/templates";

/** DocGen status for the Settings card: e-sign provider state +
 * template count. Honest by construction — the provider is the
 * in-house signing module (build queued after Phase 10), so
 * setupRequired stays true until that module ships. */
export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const [esign, templateCount] = await Promise.all([
    getEsignStatus(),
    countTemplates(),
  ]);
  return NextResponse.json({ esign, templateCount });
}
