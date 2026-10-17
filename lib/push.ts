import webPush from "web-push";
import {
  countSentToday,
  deleteSubscriptionByEndpoint,
  enqueueDigest,
  getConfig,
  getPreferences,
  getUnsentDigest,
  listSubscriptions,
  logPush,
  markDigestSent,
  mergePrefs,
  phoenixDate,
  phoenixMinutes,
  savePreferences,
  setConfig,
  type PushLogStatus,
} from "@/lib/push-db";
import { logActivity } from "@/lib/db";
import { computeBadgeCount } from "@/lib/badge";
import type { ActivityEvent } from "@/lib/types";

/**
 * Web Push sending (CRM Phase 2, Oct 14, 2026). VAPID keys are generated
 * once and persisted in push_config. sendToUser is the single funnel for
 * every notification type: it enforces the user's per-type toggle, quiet
 * hours (America/Phoenix), the daily cap per type, and the digest-bundle
 * option, and writes every outcome to push_log. Lock-screen privacy:
 * callers pass both a generic and a detailed title/body; the detailed
 * version is used only when the user enabled showDetails.
 */

const VAPID_SUBJECT = "https://portal.cannycapitalpartners.com";
const DIGEST_TYPES = ["fitSignals", "newListing", "competingBuyer"];

let vapidReady: Promise<string> | null = null;

/** Ensure VAPID keys exist (generating + persisting on first use) and the
 * web-push client is configured. Resolves to the public key. */
export function getVapid(): Promise<string> {
  if (!vapidReady) {
    vapidReady = (async () => {
      let pub = await getConfig("vapid_public");
      let priv = await getConfig("vapid_private");
      if (!pub || !priv) {
        const keys = webPush.generateVAPIDKeys();
        pub = keys.publicKey;
        priv = keys.privateKey;
        await setConfig("vapid_public", pub);
        await setConfig("vapid_private", priv);
      }
      webPush.setVapidDetails(VAPID_SUBJECT, pub, priv);
      return pub;
    })();
  }
  return vapidReady;
}

export async function getPublicKey(): Promise<string> {
  return getVapid();
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

export function inQuietHours(quietStart: string, quietEnd: string, now: Date = new Date()): boolean {
  const start = toMinutes(quietStart);
  const end = toMinutes(quietEnd);
  const cur = phoenixMinutes(now);
  if (start === end) return false;
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end; // overnight window, e.g. 21:00 → 07:00
}

export interface SendOptions {
  /** PushType name, or "test" / "digest" for the internal senders. */
  type: string;
  entityKey: string;
  genericTitle: string;
  genericBody: string;
  detailTitle: string;
  detailBody: string;
  url: string;
  /** Test sends only: skip toggle / quiet-hours / cap enforcement. */
  bypass?: boolean;
  /** Skip ONLY the daily per-type cap (toggle + quiet hours still
   * apply). Used for explicit per-event reminder alarms: a cap designed
   * for feeds must never silently swallow an alarm Ethan set himself. */
  skipDailyCap?: boolean;
}

export interface SendResult {
  status: PushLogStatus;
  error?: string;
  delivered?: number;
}

/** Fan a composed payload out to every subscription the user has.
 * Expired subscriptions (404/410) are pruned. One push_log row is
 * written per notification. */
async function deliver(
  userEmail: string,
  type: string,
  entityKey: string,
  title: string,
  body: string,
  url: string
): Promise<SendResult> {
  await getVapid();
  const subs = await listSubscriptions(userEmail);
  if (!subs.length) {
    await logPush({
      userEmail, type, entityKey, title, body, url,
      status: "failed", error: "no active subscriptions",
    });
    return { status: "failed", error: "no active subscriptions", delivered: 0 };
  }
  // Every payload carries the CURRENT server-computed badge count
  // (lib/badge) so the service worker can set the app icon from the
  // push itself, even with no page open. Best-effort: a failed count
  // never blocks the notification.
  let badge: number | undefined;
  try {
    badge = (await computeBadgeCount()).count;
  } catch {
    badge = undefined;
  }
  const payload = JSON.stringify({
    title,
    body,
    url,
    type,
    ...(badge !== undefined ? { badge } : {}),
  });
  let delivered = 0;
  let firstError = "";
  for (const sub of subs) {
    try {
      await webPush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      delivered += 1;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string; body?: string };
      if (e.statusCode === 404 || e.statusCode === 410) {
        await deleteSubscriptionByEndpoint(sub.endpoint).catch(() => undefined);
        if (!firstError) firstError = `subscription gone (${e.statusCode})`;
      } else if (!firstError) {
        firstError = e.body || e.message || String(err);
      }
    }
  }
  if (delivered > 0) {
    await logPush({ userEmail, type, entityKey, title, body, url, status: "sent" });
    return { status: "sent", delivered };
  }
  await logPush({
    userEmail, type, entityKey, title, body, url,
    status: "failed", error: firstError || "all deliveries failed",
  });
  // Audit Trail: the portal activity log's type union has no push type,
  // so this goes in with a cast — the row itself is plain text in the
  // activity table. Best-effort: an audit failure never breaks sending.
  try {
    await logActivity({
      type: "push.failed" as ActivityEvent["type"],
      actor: "push",
      message: `Push notification failed (${type}): ${firstError || "all deliveries failed"}`,
      dealId: null,
      execId: null,
      dealName: null,
      execName: null,
    });
  } catch {
    /* push_log already carries the failure */
  }
  return { status: "failed", error: firstError, delivered: 0 };
}

/** Send one notification to a user, enforcing their preferences. */
export async function sendToUser(userEmail: string, opts: SendOptions): Promise<SendResult> {
  const prefs = await getPreferences(userEmail);
  const type = opts.type;

  if (!opts.bypass) {
    // Per-type toggle (internal types like "digest" have no toggle).
    const toggle = (prefs.types as Record<string, boolean | undefined>)[type];
    if (toggle === false) {
      await logPush({
        userEmail, type, entityKey: opts.entityKey,
        title: opts.genericTitle, body: opts.genericBody, url: opts.url,
        status: "skipped-pref",
      });
      return { status: "skipped-pref" };
    }

    // Digest bundling takes precedence over quiet hours: bundled types
    // are queued (even during quiet hours) and flushed at 8 AM.
    if (prefs.digestBundle && DIGEST_TYPES.includes(type)) {
      await enqueueDigest(userEmail, type, opts.entityKey, opts.detailTitle, opts.detailBody, opts.url);
      await logPush({
        userEmail, type, entityKey: opts.entityKey,
        title: opts.detailTitle, body: opts.detailBody, url: opts.url,
        status: "digested",
      });
      return { status: "digested" };
    }

    if (inQuietHours(prefs.quietStart, prefs.quietEnd)) {
      await logPush({
        userEmail, type, entityKey: opts.entityKey,
        title: opts.genericTitle, body: opts.genericBody, url: opts.url,
        status: "skipped-quiet",
      });
      return { status: "skipped-quiet" };
    }

    const sentToday = opts.skipDailyCap ? 0 : await countSentToday(userEmail, type, phoenixDate());
    if (sentToday >= prefs.dailyCapPerType) {
      await logPush({
        userEmail, type, entityKey: opts.entityKey,
        title: opts.genericTitle, body: opts.genericBody, url: opts.url,
        status: "skipped-cap",
      });
      return { status: "skipped-cap" };
    }
  }

  const title = prefs.showDetails ? opts.detailTitle : opts.genericTitle;
  const body = prefs.showDetails ? opts.detailBody : opts.genericBody;
  return deliver(userEmail, type, opts.entityKey, title, body, opts.url);
}

/** Badge-only push: refreshes the app-icon badge on every subscribed
 * device from the server-computed attention count, without showing a
 * notification (the SW handles badgeOnly payloads silently). Used when
 * the count changes away from a device — e.g. items marked read or
 * triaged on desktop should clear the phone's badge. Best-effort and
 * deliberately NOT written to push_log: it is not a notification.
 * Platform note: delivery rides the same Web Push subscription; if a
 * platform declines silent pushes, the badge still self-corrects on
 * the next real push (payloads carry the count) and on next app open
 * (the client recalcs on foreground). */
export async function pushBadgeUpdate(userEmail: string): Promise<void> {
  try {
    await getVapid();
    const subs = await listSubscriptions(userEmail);
    if (!subs.length) return;
    const { count } = await computeBadgeCount();
    const payload = JSON.stringify({ badgeOnly: true, badge: count });
    for (const sub of subs) {
      try {
        await webPush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err) {
        const e = err as { statusCode?: number };
        if (e.statusCode === 404 || e.statusCode === 410) {
          await deleteSubscriptionByEndpoint(sub.endpoint).catch(() => undefined);
        }
      }
    }
  } catch {
    /* badge sync is best-effort */
  }
}

const DIGEST_TYPE_LABELS: Record<string, string> = {
  fitSignals: "new fit target",
  newListing: "new business for sale",
  competingBuyer: "competing-buyer acquisition",
};

/** Flush the morning digest: one bundled notification covering every
 * queued item, at/after 8:00 AM Phoenix, at most once per day. */
export async function flushDigest(userEmail: string): Promise<SendResult | null> {
  const prefs = await getPreferences(userEmail);
  if (!prefs.digestBundle) return null;
  const queue = await getUnsentDigest(userEmail);
  if (!queue.length) return null;
  const now = new Date();
  if (phoenixMinutes(now) < 8 * 60) return null;
  const today = phoenixDate(now);
  if (prefs.digestSentDate === today) return null;

  const counts = new Map<string, number>();
  for (const item of queue) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
  const parts: string[] = [];
  counts.forEach((n, t) => {
    const label = DIGEST_TYPE_LABELS[t] ?? t;
    parts.push(`${n} ${label}${n === 1 ? "" : "s"}`);
  });

  const total = queue.length;
  const genericBody = `${total} new item${total === 1 ? "" : "s"} to review`;
  const detailBody = parts.join(" · ");
  const title = prefs.showDetails ? "Morning digest" : "Morning digest";
  const body = prefs.showDetails ? detailBody : genericBody;

  const result = await deliver(userEmail, "digest", `digest-${today}`, title, body, "/overview");
  if (result.status === "sent") {
    await markDigestSent(queue.map((i) => i.id));
    await savePreferences(userEmail, mergePrefs({ ...prefs, digestSentDate: today }));
  }
  return result;
}
