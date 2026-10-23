import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import {
  getSigningSettings,
  updateSigningSettings,
} from "@/lib/signing/service";

/** Signing settings: ESIGN consent text + default expiry days.
 * GET → current settings. PUT { consentText?, defaultExpiryDays? }
 * → updated settings. */
export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const settings = await getSigningSettings();
  return NextResponse.json({ settings });
}

export async function PUT(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const consentText =
    typeof body.consentText === "string" ? body.consentText : undefined;
  const defaultExpiryDays =
    typeof body.defaultExpiryDays === "number"
      ? body.defaultExpiryDays
      : undefined;
  if (consentText === undefined && defaultExpiryDays === undefined) {
    return NextResponse.json(
      { error: "nothing_to_update", detail: "Provide consentText and/or defaultExpiryDays." },
      { status: 400 }
    );
  }
  try {
    const settings = await updateSigningSettings(
      { consentText, defaultExpiryDays },
      { name: user.name || user.email, email: user.email }
    );
    return NextResponse.json({ settings });
  } catch (err) {
    if (err instanceof Error && err.message === "consent_text_required") {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
