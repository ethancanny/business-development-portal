import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import {
  DEVICE_COOKIE,
  deleteCredential,
  deleteDevice,
  getDevice,
  listCredentials,
  listDevices,
} from "@/lib/webauthn-db";

/**
 * GET /api/devices — the signed-in user's registered devices (browser
 * sessions + passkeys) for Settings. Passkey rows are enriched with the
 * credential's created / last-used dates.
 *
 * DELETE /api/devices { id } — revoke a passkey (deletes the credential
 * and its device row). Session rows cannot be revoked per-device:
 * sessions are stateless JWTs, so the only lever is the session epoch
 * ("sign out everywhere"); session rows here are informational.
 */
export async function GET() {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [devices, creds] = await Promise.all([
    listDevices(user.id),
    listCredentials(user.id),
  ]);
  const currentDeviceId = cookies().get(DEVICE_COOKIE)?.value ?? null;
  const enriched = devices.map((d) => {
    if (d.kind !== "passkey") {
      return { ...d, isCurrent: currentDeviceId !== null && d.id === currentDeviceId };
    }
    const cred = creds.find((c) => c.credentialId === d.id);
    return {
      ...d,
      label: d.label || cred?.deviceName || "Passkey",
      createdAt: cred?.createdAt ?? d.createdAt,
      lastSeenAt: cred?.lastUsedAt ?? d.lastSeenAt,
      credentialCreatedAt: cred?.createdAt ?? null,
      credentialLastUsedAt: cred?.lastUsedAt ?? null,
      isCurrent: false,
    };
  });
  return NextResponse.json({ devices: enriched });
}

export async function DELETE(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "Device id is required" }, { status: 400 });
  }
  const device = await getDevice(id);
  if (!device || device.userId !== user.id) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }
  if (device.kind === "session") {
    return NextResponse.json(
      { error: "Use sign out everywhere for sessions" },
      { status: 400 }
    );
  }
  if (device.kind === "passkey") {
    await deleteCredential(id);
    await deleteDevice(id);
    return NextResponse.json({ ok: true });
  }
  // Push subscriptions are managed by the push settings, not here.
  return NextResponse.json(
    { error: "This device type is managed elsewhere" },
    { status: 400 }
  );
}
