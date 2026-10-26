"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * PWA shell services (CRM Phase 2), mounted once in the root layout:
 *  - registers the service worker (/sw.js)
 *  - install prompts: iOS "Add to Home Screen" instructions banner,
 *    Android beforeinstallprompt banner (one-time, dismissible)
 *  - on every launch in standalone mode: verifies the push subscription
 *    is still alive server-side (re-POST refreshes last-seen), offers a
 *    one-time "Enable notifications" prompt right after install, and
 *    syncs the app-icon badge from /api/push/badge.
 * The full notification preferences UI lives in Settings (PushSettings).
 */

const INSTALL_KEY = "ccp-install-dismissed";
const PUSH_ASKED_KEY = "ccp-push-asked";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
}

/** Human-readable device label for the push subscription record. */
function deviceName(): string {
  const ua = window.navigator.userAgent;
  let os = "";
  if (/iphone/i.test(ua)) os = "iPhone";
  else if (/ipad/i.test(ua)) os = "iPad";
  else if (/android/i.test(ua)) os = "Android";
  else if (/macintosh|mac os/i.test(ua)) os = "Mac";
  else if (/windows/i.test(ua)) os = "Windows";
  else if (/linux/i.test(ua)) os = "Linux";
  let browser = "";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/firefox/i.test(ua)) browser = "Firefox";
  else if (/chrome|crios/i.test(ua)) browser = "Chrome";
  else if (/safari/i.test(ua)) browser = "Safari";
  if (os && browser) return `${os} ${browser}`;
  return os || browser || "This device";
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = window.atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Subscribe this browser to Web Push and register it with the backend. */
async function subscribePush(): Promise<boolean> {
  const reg = await navigator.serviceWorker.ready;
  let key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  if (!key) {
    try {
      const r = await fetch("/api/push/config");
      if (r.ok) key = (await r.json()).publicKey ?? "";
    } catch {
      /* backend key endpoint unavailable — subscribe stays a Settings flow */
    }
  }
  if (!key) return false;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  });
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON(), deviceName: deviceName() }),
  });
  return true;
}

export default function PwaShell() {
  const pathname = usePathname();
  const [standalone, setStandalone] = useState(false);
  const [showIosInstall, setShowIosInstall] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showAndroidInstall, setShowAndroidInstall] = useState(false);
  const [showPushPrompt, setShowPushPrompt] = useState(false);
  const verifiedRef = useRef(false);

  const onLogin = pathname === "/login";
  // Ethan (Oct 14, 2026): the install + notification asks appear ONLY
  // on the Overview page — once, then permanently dismissed (the
  // localStorage flags set by the dismiss handlers below).
  const onOverview = pathname === "/overview";

  /* --- service worker registration (everywhere, incl. /login) --- */
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  /* --- Android install prompt capture --- */
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      // Shown-once rule: if the ask was ever displayed, never capture again.
      try {
        if (localStorage.getItem(INSTALL_KEY) === "1") return;
        localStorage.setItem(INSTALL_KEY, "1");
      } catch {
        /* storage unavailable — fall through and show this once */
      }
      setInstallEvent(e as BeforeInstallPromptEvent);
      setShowAndroidInstall(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  /* --- decide which one-time banners apply --- */
  useEffect(() => {
    const sa = isStandalone();
    setStandalone(sa);
    let installDismissed = false;
    let pushAsked = false;
    try {
      installDismissed = localStorage.getItem(INSTALL_KEY) === "1";
      pushAsked = localStorage.getItem(PUSH_ASKED_KEY) === "1";
    } catch {
      /* storage unavailable */
    }
    // Ethan (Oct 14): the ask comes up ONCE — the flag is written when the
    // banner is shown, not when it is dismissed, so a refresh never re-asks.
    if (!sa && !installDismissed && isIOS()) {
      try { localStorage.setItem(INSTALL_KEY, "1"); } catch { /* ignore */ }
      setShowIosInstall(true);
    }
    if (sa && !pushAsked && "Notification" in window && Notification.permission === "default") {
      try { localStorage.setItem(PUSH_ASKED_KEY, "1"); } catch { /* ignore */ }
      setShowPushPrompt(true);
    }
  }, []);

  /* --- app-icon badge sync (overdue follow-ups + items needing review) ---
   * Version gate (Performance Fix Pass, DESIGN §8): before paying for
   * /api/push/badge, check the tasks+dealflow dataset versions (one
   * tiny no-store GET). If the fingerprint is unchanged since the last
   * badge fetch, the badge cannot have changed — skip the fetch. If
   * the versions check itself fails, fall back to fetching the badge
   * (the pre-gate behavior). */
  const badgeFingerprintRef = useRef<string | null>(null);
  const lastBadgeCheckRef = useRef(0);

  const syncBadge = useCallback(async () => {
    try {
      const nav = window.navigator as Navigator & {
        setAppBadge?: (n: number) => Promise<void>;
        clearAppBadge?: () => Promise<void>;
      };
      if (typeof nav.setAppBadge !== "function") return;
      lastBadgeCheckRef.current = Date.now();
      let fingerprint: string | null = null;
      try {
        const vr = await fetch("/api/platform/versions?datasets=tasks,dealflow", {
          cache: "no-store",
        });
        if (vr.ok) {
          const vb: unknown = await vr.json().catch(() => null);
          const vs =
            vb && typeof vb === "object"
              ? ((vb as { versions?: Record<string, number> }).versions ?? {})
              : {};
          fingerprint = `${vs.tasks ?? "?"}:${vs.dealflow ?? "?"}`;
        }
      } catch {
        /* versions unavailable — fingerprint stays null, badge fetches */
      }
      if (fingerprint !== null && fingerprint === badgeFingerprintRef.current) {
        return;
      }
      const r = await fetch("/api/push/badge");
      if (!r.ok) return;
      const d = await r.json().catch(() => null);
      const count = typeof d?.count === "number" ? d.count : 0;
      if (count > 0) await nav.setAppBadge(count);
      else if (typeof nav.clearAppBadge === "function") await nav.clearAppBadge();
      if (fingerprint !== null) badgeFingerprintRef.current = fingerprint;
    } catch {
      /* badge is best-effort */
    }
  }, []);

  /* Foreground triggers (focus / visibility / pageshow) are throttled:
   * at most one version check per 30s no matter how often the app is
   * foregrounded. Explicit refresh paths call syncBadge directly. */
  const syncBadgeThrottled = useCallback(() => {
    if (Date.now() - lastBadgeCheckRef.current < 30000) return;
    void syncBadge();
  }, [syncBadge]);

  /* --- per-launch push verification + badge (standalone, signed-in app) --- */
  useEffect(() => {
    if (!standalone || onLogin || verifiedRef.current) return;
    verifiedRef.current = true;

    (async () => {
      try {
        if ("Notification" in window && Notification.permission === "granted" && "serviceWorker" in navigator) {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            // Re-registering refreshes the server's last-seen timestamp
            // and confirms the subscription is still valid.
            await fetch("/api/push/subscribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ subscription: sub.toJSON(), deviceName: deviceName() }),
            });
          } else {
            // Subscription dropped — re-subscribe so pushes resume.
            await subscribePush().catch(() => false);
          }
        }
      } catch {
        /* verification is best-effort; Settings shows true state */
      }
      syncBadge();
    })();

    const onVisible = () => {
      if (document.visibilityState === "visible") syncBadgeThrottled();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [standalone, onLogin, syncBadge, syncBadgeThrottled]);

  /* --- badge triggers for the whole session (Oct 16, 2026) ---
   * The per-launch effect above registers one visibility listener, but
   * it is one-shot (verifiedRef) and unregisters on route changes —
   * the badge could go stale for the rest of a session. These triggers
   * are registered once, independent of push verification, and always
   * recalculate from the server (lib/badge) — never a local delta. */
  useEffect(() => {
    // Foreground returns are throttled (30s); explicit refresh paths
    // skip the throttle but still pass syncBadge's fingerprint check
    // first — a post-mutation server bump changes the fingerprint, so
    // the badge refetch still happens exactly when it should.
    const onForeground = () => syncBadgeThrottled();
    const onExplicit = () => void syncBadge();
    const onVisible = () => {
      if (document.visibilityState === "visible") syncBadgeThrottled();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onForeground);
    window.addEventListener("pageshow", onForeground);
    window.addEventListener("ccp:badge-refresh", onExplicit);
    // Explicit hook for any mutation code: window.ccpBadgeRefresh().
    (window as unknown as { ccpBadgeRefresh?: () => void }).ccpBadgeRefresh =
      () => syncBadge();

    // Mutation observer: a successful write to the follow-up (tasks)
    // or Activity (deal-flow) APIs can change what needs attention —
    // complete / snooze / reschedule / delete a follow-up, triage or
    // mark-read a feed item — so recalc from the server rather than
    // guessing the delta. Observes responses only; requests pass
    // through untouched.
    const origFetch = window.fetch.bind(window);
    let active = true;
    window.fetch = async (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      const res = await origFetch(...args);
      try {
        if (active && res.ok) {
          const input = args[0] as unknown;
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : ((input as Request)?.url ?? "");
          const method =
            (input as Request)?.method ?? args[1]?.method ?? "GET";
          if (String(method).toUpperCase() !== "GET" && url) {
            const path = new URL(url, window.location.origin).pathname;
            if (
              path.startsWith("/api/tasks") ||
              path.startsWith("/api/deal-flow")
            ) {
              setTimeout(() => syncBadge(), 0);
            }
          }
        }
      } catch {
        /* observer is best-effort */
      }
      return res;
    };

    return () => {
      active = false;
      window.fetch = origFetch;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onForeground);
      window.removeEventListener("pageshow", onForeground);
      window.removeEventListener("ccp:badge-refresh", onExplicit);
    };
  }, [syncBadge, syncBadgeThrottled]);

  /* --- badge on navigation; unconditional clear when signed out ---
   * Arriving anywhere in the app (including right after login)
   * recalcs; landing on /login — i.e. after any logout path — clears
   * the badge outright so a signed-out phone never keeps showing the
   * previous session's count. */
  useEffect(() => {
    if (pathname === "/login") {
      try {
        const nav = window.navigator as Navigator & {
          clearAppBadge?: () => Promise<void>;
        };
        if (typeof nav.clearAppBadge === "function") {
          void nav.clearAppBadge();
        }
      } catch {
        /* badge is best-effort */
      }
      return;
    }
    syncBadge();
  }, [pathname, syncBadge]);

  const dismissInstall = () => {
    try {
      localStorage.setItem(INSTALL_KEY, "1");
    } catch {
      /* ignore */
    }
    setShowIosInstall(false);
    setShowAndroidInstall(false);
    setInstallEvent(null);
  };

  const runAndroidInstall = async () => {
    if (!installEvent) return;
    try {
      await installEvent.prompt();
      await installEvent.userChoice;
    } catch {
      /* user dismissed the native sheet */
    }
    dismissInstall();
  };

  const enableNotifications = async () => {
    try {
      localStorage.setItem(PUSH_ASKED_KEY, "1");
    } catch {
      /* ignore */
    }
    setShowPushPrompt(false);
    try {
      const perm = await Notification.requestPermission();
      if (perm === "granted") await subscribePush();
    } catch {
      /* permission flow failed — Settings remains available */
    }
  };

  const dismissPushPrompt = () => {
    try {
      localStorage.setItem(PUSH_ASKED_KEY, "1");
    } catch {
      /* ignore */
    }
    setShowPushPrompt(false);
  };

  if (onLogin) return null;

  const bannerCls =
    "fixed inset-x-3 bottom-[calc(94px+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md rounded-xl border border-[#b8975a]/50 bg-[#0d1f3c] px-4 py-3 shadow-pop md:bottom-4";
  const btnCls = "btn btn-accent px-4";
  const ghostCls =
    "min-h-[44px] rounded-xl px-3 py-2 text-sm font-medium text-[#c8bfa8] transition hover:text-white";

  return (
    <>
      {onOverview && showIosInstall && (
        <div className={bannerCls} role="dialog" aria-label="Install app">
          <p className="text-sm font-semibold text-white">Install Canny Capital Portal</p>
          <p className="mt-1 text-sm leading-relaxed text-[#e8dfc8]">
            Tap the <span className="font-semibold text-white">Share</span> button in
            Safari, then <span className="font-semibold text-white">Add to Home Screen</span> —
            the portal then opens full-screen, with notifications.
          </p>
          <div className="mt-2 flex justify-end">
            <button onClick={dismissInstall} className={ghostCls}>
              Not now
            </button>
          </div>
        </div>
      )}

      {onOverview && !showIosInstall && showAndroidInstall && installEvent && !standalone && (
        <div className={bannerCls} role="dialog" aria-label="Install app">
          <p className="text-sm font-semibold text-white">Install Canny Capital Portal</p>
          <p className="mt-1 text-sm text-[#e8dfc8]">
            Add the portal to your home screen for full-screen use and notifications.
          </p>
          <div className="mt-2 flex items-center justify-end gap-1">
            <button onClick={dismissInstall} className={ghostCls}>
              Not now
            </button>
            <button onClick={runAndroidInstall} className={btnCls}>
              Install
            </button>
          </div>
        </div>
      )}

      {onOverview && standalone && showPushPrompt && (
        <div className={bannerCls} role="dialog" aria-label="Enable notifications">
          <p className="text-sm font-semibold text-white">Stay in the loop</p>
          <p className="mt-1 text-sm text-[#e8dfc8]">
            Get alerts for meetings, due follow-ups, new fit targets, and fresh
            Arizona listings. You can fine-tune them in Settings.
          </p>
          <div className="mt-2 flex items-center justify-end gap-1">
            <button onClick={dismissPushPrompt} className={ghostCls}>
              Not now
            </button>
            <button onClick={enableNotifications} className={btnCls}>
              Enable notifications
            </button>
          </div>
        </div>
      )}
    </>
  );
}
