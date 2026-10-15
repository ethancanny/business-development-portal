import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { AuthenticatorTransport } from "@simplewebauthn/server";
import type { AuthUser } from "./auth";

/**
 * Passkeys (WebAuthn), per-user security settings, and the device
 * registry (CRM Phase 2, Oct 2026). Stored in Neon like the investors
 * table; server-side only.
 *
 * The portal has a single partner account (seeded in lib/auth.ts).
 * WebAuthn sign-in resolves an email to that account here, since
 * lib/auth.ts only exposes password verification.
 */

export const RP_ID = "portal.cannycapitalpartners.com";
export const RP_NAME = "Canny Capital Portal";
export const EXPECTED_ORIGIN = "https://portal.cannycapitalpartners.com";

export const DEVICE_COOKIE = "ccp_device";

export function deviceCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    secure: process.env.NODE_ENV === "production",
  };
}

/** Coarse device label from a User-Agent string, for the device list. */
export function deviceLabelFromUA(ua: string): string {
  const s = ua || "";
  let device = "Unknown device";
  if (/iPhone/i.test(s)) device = "iPhone";
  else if (/iPad/i.test(s)) device = "iPad";
  else if (/Android/i.test(s)) device = "Android";
  else if (/Macintosh|Mac OS/i.test(s)) device = "Mac";
  else if (/Windows/i.test(s)) device = "Windows PC";
  else if (/Linux/i.test(s)) device = "Linux";
  let browser = "";
  if (/Edg\//i.test(s)) browser = "Edge";
  else if (/CriOS|Chrome\//i.test(s)) browser = "Chrome";
  else if (/FxiOS|Firefox\//i.test(s)) browser = "Firefox";
  else if (/Safari\//i.test(s)) browser = "Safari";
  return browser ? `${device} (${browser})` : device;
}

const SEED_USER: AuthUser = {
  id: "partner-ethan",
  name: "Ethan Canny",
  email: "ethan@cannycapitalpartners.com",
};

/** Resolve an email to the portal's single partner account, if it matches. */
export function findSeedUser(email: string): AuthUser | null {
  if (!email) return null;
  return email.trim().toLowerCase() === SEED_USER.email ? SEED_USER : null;
}

type Sql = NeonQueryFunction<false, false>;

let cached: Sql | null = null;
function sql(): Sql {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    cached = neon(url);
  }
  return cached;
}

let ensured = false;
async function ensure(): Promise<void> {
  if (ensured) return;
  const q = sql();
  await q`CREATE TABLE IF NOT EXISTS webauthn_credentials (
    credential_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    public_key TEXT NOT NULL DEFAULT '',
    counter BIGINT NOT NULL DEFAULT 0,
    transports TEXT NOT NULL DEFAULT '[]',
    device_name TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
  )`;
  await q`CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id TEXT PRIMARY KEY,
    user_key TEXT NOT NULL,
    challenge TEXT NOT NULL,
    purpose TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  )`;
  await q`CREATE TABLE IF NOT EXISTS user_security (
    user_id TEXT PRIMARY KEY,
    session_epoch INT NOT NULL DEFAULT 0,
    lock_minutes INT NOT NULL DEFAULT 15
  )`;
  await q`CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'session',
    label TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked BOOLEAN NOT NULL DEFAULT false
  )`;
  ensured = true;
}

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/* ---------------- Credentials ---------------- */

export interface StoredCredential {
  credentialId: string;
  userId: string;
  /** base64url-encoded COSE public key */
  publicKey: string;
  counter: number;
  transports: AuthenticatorTransport[];
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

function rowToCredential(r: Record<string, unknown>): StoredCredential {
  let transports: AuthenticatorTransport[] = [];
  try {
    const parsed = JSON.parse(str(r.transports) || "[]");
    if (Array.isArray(parsed)) transports = parsed as AuthenticatorTransport[];
  } catch {
    transports = [];
  }
  return {
    credentialId: str(r.credential_id),
    userId: str(r.user_id),
    publicKey: str(r.public_key),
    counter: Number(r.counter ?? 0),
    transports,
    deviceName: str(r.device_name),
    createdAt: str(r.created_at),
    lastUsedAt: r.last_used_at ? str(r.last_used_at) : null,
  };
}

export async function listCredentials(userId: string): Promise<StoredCredential[]> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT * FROM webauthn_credentials WHERE user_id = ${userId} ORDER BY created_at ASC`;
  return rows.map((r) => rowToCredential(r as Record<string, unknown>));
}

export async function getCredential(credentialId: string): Promise<StoredCredential | null> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT * FROM webauthn_credentials WHERE credential_id = ${credentialId}`;
  if (!rows.length) return null;
  return rowToCredential(rows[0] as Record<string, unknown>);
}

export async function saveCredential(cred: {
  credentialId: string;
  userId: string;
  publicKey: string;
  counter: number;
  transports: AuthenticatorTransport[];
  deviceName: string;
}): Promise<void> {
  await ensure();
  const q = sql();
  await q`INSERT INTO webauthn_credentials (credential_id, user_id, public_key, counter, transports, device_name)
    VALUES (${cred.credentialId}, ${cred.userId}, ${cred.publicKey}, ${cred.counter}, ${JSON.stringify(cred.transports)}, ${cred.deviceName})
    ON CONFLICT (credential_id) DO UPDATE SET
      public_key = EXCLUDED.public_key,
      counter = EXCLUDED.counter,
      transports = EXCLUDED.transports,
      device_name = EXCLUDED.device_name`;
}

export async function updateCredentialCounter(credentialId: string, counter: number): Promise<void> {
  await ensure();
  const q = sql();
  await q`UPDATE webauthn_credentials SET counter = ${counter}, last_used_at = now() WHERE credential_id = ${credentialId}`;
}

export async function deleteCredential(credentialId: string): Promise<void> {
  await ensure();
  const q = sql();
  await q`DELETE FROM webauthn_credentials WHERE credential_id = ${credentialId}`;
}

/* ---------------- Challenges ---------------- */

export type ChallengePurpose = "register" | "auth" | "unlock";

export async function saveChallenge(
  userKey: string,
  challenge: string,
  purpose: ChallengePurpose
): Promise<void> {
  await ensure();
  const q = sql();
  const id = `${userKey}:${purpose}`;
  // One live challenge per (user, purpose); issuing a new one replaces it.
  await q`DELETE FROM webauthn_challenges WHERE user_key = ${userKey} AND purpose = ${purpose}`;
  await q`INSERT INTO webauthn_challenges (id, user_key, challenge, purpose, expires_at)
    VALUES (${id}, ${userKey}, ${challenge}, ${purpose}, now() + interval '5 minutes')`;
}

export async function getChallenge(
  userKey: string,
  purpose: ChallengePurpose
): Promise<string | null> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT challenge FROM webauthn_challenges
    WHERE user_key = ${userKey} AND purpose = ${purpose} AND expires_at > now()
    ORDER BY expires_at DESC LIMIT 1`;
  if (!rows.length) return null;
  return str((rows[0] as Record<string, unknown>).challenge);
}

export async function deleteChallenge(userKey: string, purpose: ChallengePurpose): Promise<void> {
  await ensure();
  const q = sql();
  await q`DELETE FROM webauthn_challenges WHERE user_key = ${userKey} AND purpose = ${purpose}`;
}

/* ---------------- User security settings ---------------- */

export interface UserSecurity {
  userId: string;
  sessionEpoch: number;
  lockMinutes: number;
}

export async function getSecurity(userId: string): Promise<UserSecurity> {
  await ensure();
  const q = sql();
  await q`INSERT INTO user_security (user_id) VALUES (${userId}) ON CONFLICT (user_id) DO NOTHING`;
  const rows = await q`SELECT * FROM user_security WHERE user_id = ${userId}`;
  const r = (rows[0] ?? {}) as Record<string, unknown>;
  return {
    userId,
    sessionEpoch: Number(r.session_epoch ?? 0),
    lockMinutes: Number(r.lock_minutes ?? 15),
  };
}

/** Invalidate every outstanding session token (sign out everywhere). */
export async function bumpEpoch(userId: string): Promise<number> {
  await ensure();
  const q = sql();
  await q`INSERT INTO user_security (user_id) VALUES (${userId}) ON CONFLICT (user_id) DO NOTHING`;
  const rows = await q`UPDATE user_security SET session_epoch = session_epoch + 1
    WHERE user_id = ${userId} RETURNING session_epoch`;
  return Number((rows[0] as Record<string, unknown>)?.session_epoch ?? 0);
}

export async function setLockMinutes(userId: string, minutes: number): Promise<void> {
  await ensure();
  const q = sql();
  const clamped = Math.max(1, Math.min(480, Math.round(minutes)));
  await q`INSERT INTO user_security (user_id, lock_minutes) VALUES (${userId}, ${clamped})
    ON CONFLICT (user_id) DO UPDATE SET lock_minutes = EXCLUDED.lock_minutes`;
}

/* ---------------- Devices ---------------- */

export type DeviceKind = "session" | "passkey" | "push";

export interface DeviceRow {
  id: string;
  userId: string;
  kind: DeviceKind;
  label: string;
  createdAt: string;
  lastSeenAt: string;
  revoked: boolean;
}

function rowToDevice(r: Record<string, unknown>): DeviceRow {
  return {
    id: str(r.id),
    userId: str(r.user_id),
    kind: (str(r.kind) || "session") as DeviceKind,
    label: str(r.label),
    createdAt: str(r.created_at),
    lastSeenAt: str(r.last_seen_at),
    revoked: r.revoked === true,
  };
}

/** Upsert a device row (session sign-in, passkey registration, push sub). */
export async function registerDevice(d: {
  id: string;
  userId: string;
  kind: DeviceKind;
  label: string;
}): Promise<void> {
  await ensure();
  const q = sql();
  await q`INSERT INTO devices (id, user_id, kind, label)
    VALUES (${d.id}, ${d.userId}, ${d.kind}, ${d.label})
    ON CONFLICT (id) DO UPDATE SET
      label = EXCLUDED.label,
      last_seen_at = now()`;
}

export async function listDevices(userId: string): Promise<DeviceRow[]> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT * FROM devices WHERE user_id = ${userId} AND revoked = false ORDER BY last_seen_at DESC`;
  return rows.map((r) => rowToDevice(r as Record<string, unknown>));
}

export async function getDevice(id: string): Promise<DeviceRow | null> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT * FROM devices WHERE id = ${id}`;
  if (!rows.length) return null;
  return rowToDevice(rows[0] as Record<string, unknown>);
}

export async function touchDevice(id: string): Promise<void> {
  await ensure();
  const q = sql();
  await q`UPDATE devices SET last_seen_at = now() WHERE id = ${id}`;
}

export async function deleteDevice(id: string): Promise<void> {
  await ensure();
  const q = sql();
  await q`DELETE FROM devices WHERE id = ${id}`;
}
