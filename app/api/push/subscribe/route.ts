import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { deleteSubscription, listSubscriptions, upsertSubscription } from "@/lib/push-db";

/** The caller's registered devices (for Settings → device management). */
export async function GET() {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const subs = await listSubscriptions(user.email);
  return NextResponse.json({
    subscriptions: subs.map((s) => ({
      id: s.id,
      endpoint: s.endpoint,
      deviceName: s.deviceName,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
    })),
  });
}

/** Register (or refresh) this device's push subscription. One row per
 * endpoint; last_seen_at updates on every call, so app launches should
 * re-POST to verify the subscription is still alive. */
export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const sub = (body?.subscription ?? {}) as Record<string, unknown>;
  const keys = (sub.keys ?? {}) as Record<string, unknown>;
  const endpoint = String(sub.endpoint ?? "");
  const p256dh = String(keys.p256dh ?? "");
  const auth = String(keys.auth ?? "");
  const deviceName = String(body?.deviceName ?? "").slice(0, 120);
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "subscription.endpoint and keys are required" }, { status: 400 });
  }
  await upsertSubscription(user.email, endpoint, p256dh, auth, deviceName);
  return NextResponse.json({ ok: true });
}

/** Remove a device subscription (must belong to the caller). */
export async function DELETE(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const endpoint = String(body?.endpoint ?? "");
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  }
  await deleteSubscription(user.email, endpoint);
  return NextResponse.json({ ok: true });
}
