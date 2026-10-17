import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { randomUUID } from "crypto";

/**
 * Push notifications storage (CRM Phase 2, Oct 14, 2026): VAPID config,
 * per-device subscriptions, per-user preferences, a send log (dedupe,
 * daily caps, and the failure audit trail all read it), and the morning
 * digest queue. Neon Postgres, server-side only — same connection and
 * ensure-schema pattern as lib/investors-db.ts.
 */

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
  await q`CREATE TABLE IF NOT EXISTS push_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  )`;
  await q`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    device_name TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await q`CREATE TABLE IF NOT EXISTS push_preferences (
    user_email TEXT PRIMARY KEY,
    prefs JSONB NOT NULL DEFAULT '{}'
  )`;
  await q`CREATE TABLE IF NOT EXISTS push_log (
    id TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    type TEXT NOT NULL,
    entity_key TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await q`CREATE INDEX IF NOT EXISTS push_log_lookup
    ON push_log (user_email, type, entity_key, created_at)`;
  await q`CREATE TABLE IF NOT EXISTS push_digest_queue (
    id TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    type TEXT NOT NULL,
    entity_key TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ
  )`;
  ensured = true;
}

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/* ---------------- Phoenix time helpers ----------------
 * All push scheduling (quiet hours, daily caps, digest) runs on
 * America/Phoenix wall-clock time. */

/** YYYY-MM-DD in America/Phoenix for the given instant. */
export function phoenixDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Minutes since midnight in America/Phoenix for the given instant. */
export function phoenixMinutes(d: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === "hour") h = parseInt(p.value, 10) % 24;
    if (p.type === "minute") m = parseInt(p.value, 10);
  }
  return h * 60 + m;
}

/* ---------------- Config (VAPID keys) ---------------- */

export async function getConfig(key: string): Promise<string | null> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT value FROM push_config WHERE key = ${key}`;
  return rows.length ? str(rows[0].value) : null;
}

export async function setConfig(key: string, value: string): Promise<void> {
  await ensure();
  const q = sql();
  await q`INSERT INTO push_config (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

/* ---------------- Subscriptions ---------------- */

export interface PushSubscriptionRow {
  id: string;
  userEmail: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt: string;
}

function rowToSub(r: Record<string, unknown>): PushSubscriptionRow {
  return {
    id: str(r.id),
    userEmail: str(r.user_email),
    endpoint: str(r.endpoint),
    p256dh: str(r.p256dh),
    auth: str(r.auth),
    deviceName: str(r.device_name),
    createdAt: str(r.created_at),
    lastSeenAt: str(r.last_seen_at),
  };
}

export async function upsertSubscription(
  userEmail: string,
  endpoint: string,
  p256dh: string,
  auth: string,
  deviceName: string
): Promise<void> {
  await ensure();
  const q = sql();
  await q`INSERT INTO push_subscriptions (id, user_email, endpoint, p256dh, auth, device_name, last_seen_at)
    VALUES (${randomUUID()}, ${userEmail}, ${endpoint}, ${p256dh}, ${auth}, ${deviceName}, now())
    ON CONFLICT (endpoint) DO UPDATE SET
      user_email = EXCLUDED.user_email,
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      device_name = CASE WHEN EXCLUDED.device_name <> '' THEN EXCLUDED.device_name ELSE push_subscriptions.device_name END,
      last_seen_at = now()`;
}

export async function listSubscriptions(userEmail: string): Promise<PushSubscriptionRow[]> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT * FROM push_subscriptions WHERE user_email = ${userEmail} ORDER BY last_seen_at DESC`;
  return rows.map((r) => rowToSub(r as Record<string, unknown>));
}

export async function deleteSubscription(userEmail: string, endpoint: string): Promise<void> {
  await ensure();
  const q = sql();
  await q`DELETE FROM push_subscriptions WHERE user_email = ${userEmail} AND endpoint = ${endpoint}`;
}

export async function deleteSubscriptionByEndpoint(endpoint: string): Promise<void> {
  await ensure();
  const q = sql();
  await q`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
}

/* ---------------- Preferences ---------------- */

export type PushType =
  | "meeting60"
  | "eventReminder"
  | "followups"
  | "fitSignals"
  | "newListing"
  | "stalled"
  | "quiet60_90"
  | "competingBuyer"
  | "feedDown";

export const PUSH_TYPES: PushType[] = [
  "meeting60",
  "eventReminder",
  "followups",
  "fitSignals",
  "newListing",
  "stalled",
  "quiet60_90",
  "competingBuyer",
  "feedDown",
];

export interface PushPreferences {
  types: Record<PushType, boolean>;
  quietStart: string; // "HH:MM" Phoenix local
  quietEnd: string; // "HH:MM" Phoenix local
  dailyCapPerType: number;
  digestBundle: boolean;
  showDetails: boolean;
  digestSentDate: string; // YYYY-MM-DD (Phoenix) of the last digest sent
}

export const DEFAULT_PREFS: PushPreferences = {
  types: {
    meeting60: true,
    eventReminder: true,
    followups: true,
    fitSignals: true,
    newListing: true,
    stalled: true,
    quiet60_90: true,
    competingBuyer: true,
    feedDown: true,
  },
  quietStart: "21:00",
  quietEnd: "07:00",
  dailyCapPerType: 5,
  digestBundle: false,
  showDetails: false,
  digestSentDate: "",
};

const TIME_RE = /^\d{2}:\d{2}$/;

/** Merge a (possibly partial / untrusted) stored or submitted prefs blob
 * over the defaults, validating each field. */
export function mergePrefs(raw: unknown): PushPreferences {
  const out: PushPreferences = {
    ...DEFAULT_PREFS,
    types: { ...DEFAULT_PREFS.types },
  };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (r.types && typeof r.types === "object") {
    const t = r.types as Record<string, unknown>;
    for (const k of PUSH_TYPES) {
      if (typeof t[k] === "boolean") out.types[k] = t[k] as boolean;
    }
  }
  if (typeof r.quietStart === "string" && TIME_RE.test(r.quietStart)) out.quietStart = r.quietStart;
  if (typeof r.quietEnd === "string" && TIME_RE.test(r.quietEnd)) out.quietEnd = r.quietEnd;
  if (typeof r.dailyCapPerType === "number" && Number.isFinite(r.dailyCapPerType)) {
    out.dailyCapPerType = Math.min(50, Math.max(1, Math.round(r.dailyCapPerType)));
  }
  if (typeof r.digestBundle === "boolean") out.digestBundle = r.digestBundle;
  if (typeof r.showDetails === "boolean") out.showDetails = r.showDetails;
  if (typeof r.digestSentDate === "string") out.digestSentDate = r.digestSentDate;
  return out;
}

export async function getPreferences(userEmail: string): Promise<PushPreferences> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT prefs FROM push_preferences WHERE user_email = ${userEmail}`;
  if (!rows.length) return mergePrefs(null);
  const raw = rows[0].prefs;
  return mergePrefs(typeof raw === "string" ? safeParse(raw) : raw);
}

export async function savePreferences(userEmail: string, prefs: PushPreferences): Promise<void> {
  await ensure();
  const q = sql();
  await q`INSERT INTO push_preferences (user_email, prefs)
    VALUES (${userEmail}, ${JSON.stringify(prefs)}::jsonb)
    ON CONFLICT (user_email) DO UPDATE SET prefs = EXCLUDED.prefs`;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* ---------------- Send log (dedupe / caps / audit) ---------------- */

export type PushLogStatus =
  | "sent"
  | "failed"
  | "skipped-pref"
  | "skipped-quiet"
  | "skipped-cap"
  | "digested";

export interface PushLogEntry {
  userEmail: string;
  type: string;
  entityKey: string;
  title: string;
  body: string;
  url: string;
  status: PushLogStatus;
  error?: string;
}

export async function logPush(e: PushLogEntry): Promise<void> {
  await ensure();
  const q = sql();
  await q`INSERT INTO push_log (id, user_email, type, entity_key, title, body, url, status, error)
    VALUES (${randomUUID()}, ${e.userEmail}, ${e.type}, ${e.entityKey}, ${e.title}, ${e.body}, ${e.url}, ${e.status}, ${e.error ?? ""})`;
}

/** True if a log row exists for (user, type, entityKey) with one of the
 * given statuses since the given instant — the dedupe primitive. */
export async function hasRecentLog(
  userEmail: string,
  type: string,
  entityKey: string,
  statuses: PushLogStatus[],
  since: Date
): Promise<boolean> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT 1 AS one FROM push_log
    WHERE user_email = ${userEmail} AND type = ${type} AND entity_key = ${entityKey}
      AND status = ANY(${statuses}) AND created_at >= ${since.toISOString()}
    LIMIT 1`;
  return rows.length > 0;
}

/** Notifications actually sent today (Phoenix date) for one type — the
 * daily-cap counter. Bundled-alert marker rows (written per contact for
 * dedupe, titled "(bundled …") are excluded: they are bookkeeping, not
 * notifications. */
export async function countSentToday(userEmail: string, type: string, date: string): Promise<number> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT count(*)::int AS n FROM push_log
    WHERE user_email = ${userEmail} AND type = ${type} AND status = 'sent'
      AND title NOT LIKE '(bundled%'
      AND (created_at AT TIME ZONE 'America/Phoenix')::date = ${date}::date`;
  return Number(rows[0]?.n ?? 0);
}

/* ---------------- Digest queue ---------------- */

export interface DigestQueueRow {
  id: string;
  type: string;
  entityKey: string;
  title: string;
  body: string;
  url: string;
  createdAt: string;
}

export async function enqueueDigest(
  userEmail: string,
  type: string,
  entityKey: string,
  title: string,
  body: string,
  url: string
): Promise<void> {
  await ensure();
  const q = sql();
  await q`INSERT INTO push_digest_queue (id, user_email, type, entity_key, title, body, url)
    VALUES (${randomUUID()}, ${userEmail}, ${type}, ${entityKey}, ${title}, ${body}, ${url})`;
}

export async function getUnsentDigest(userEmail: string): Promise<DigestQueueRow[]> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT * FROM push_digest_queue
    WHERE user_email = ${userEmail} AND sent_at IS NULL ORDER BY created_at ASC`;
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      id: str(rec.id),
      type: str(rec.type),
      entityKey: str(rec.entity_key),
      title: str(rec.title),
      body: str(rec.body),
      url: str(rec.url),
      createdAt: str(rec.created_at),
    };
  });
}

export async function markDigestSent(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await ensure();
  const q = sql();
  await q`UPDATE push_digest_queue SET sent_at = now() WHERE id = ANY(${ids})`;
}

/* ---------------- Fit-signal scan (evaluator c) ----------------
 * mi_companies carries `fit` and the owner-transition `signals` array
 * inside its details JSON, so this reads the table directly with the
 * same sql handle rather than paging getCompanies(). */

export interface FitSignalCompany {
  dedupKey: string;
  name: string;
  sector: string;
  signalCount: number;
}

export async function getRecentFitSignalCompanies(sinceISO: string, limit = 200): Promise<FitSignalCompany[]> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT dedup_key, name, sector, details FROM mi_companies
    WHERE first_seen >= ${sinceISO} AND status <> 'dismissed'
      AND details LIKE '{%' AND (details::jsonb ->> 'fit') = 'true'
    ORDER BY first_seen DESC LIMIT ${limit}`;
  const out: FitSignalCompany[] = [];
  for (const r of rows) {
    const rec = r as Record<string, unknown>;
    let signals: unknown = null;
    try {
      const det = JSON.parse(str(rec.details));
      signals = det && typeof det === "object" ? (det as Record<string, unknown>).signals : null;
    } catch {
      signals = null;
    }
    if (Array.isArray(signals) && signals.length >= 2) {
      out.push({
        dedupKey: str(rec.dedup_key),
        name: str(rec.name),
        sector: str(rec.sector),
        signalCount: signals.length,
      });
    }
  }
  return out;
}
