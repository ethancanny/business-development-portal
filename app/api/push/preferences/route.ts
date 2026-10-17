import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getPreferences, mergePrefs, savePreferences } from "@/lib/push-db";

/** The caller's push preferences (defaults merged in). */
export async function GET() {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ preferences: await getPreferences(user.email) });
}

/** Partial update: any subset of the preference fields; values are
 * validated/clamped by mergePrefs. */
export async function PUT(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const current = await getPreferences(user.email);
  const incoming = (body?.preferences ?? body ?? {}) as Record<string, unknown>;
  // Merge type toggles key-by-key so a partial types object doesn't
  // reset the toggles it doesn't mention.
  const merged = mergePrefs({
    ...current,
    ...incoming,
    types: { ...current.types, ...((incoming.types as Record<string, unknown>) ?? {}) },
    digestSentDate: current.digestSentDate, // server-managed; not user-editable
    reminderDigestDate: current.reminderDigestDate, // server-managed; not user-editable
  });
  await savePreferences(user.email, merged);
  return NextResponse.json({ preferences: merged });
}
