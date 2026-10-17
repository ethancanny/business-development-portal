"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Push notification settings (CRM Phase 2, Oct 14, 2026). Self-contained:
 * fetches and saves through /api/push/*. Rendered by the Settings page.
 * Covers the test send, per-type toggles, quiet hours, the daily cap,
 * digest bundling, lock-screen detail privacy, and device management.
 */

type PushTypeKey =
  | "meeting60"
  | "eventReminder"
  | "followups"
  | "fitSignals"
  | "newListing"
  | "stalled"
  | "quiet60_90"
  | "competingBuyer"
  | "feedDown";

interface Prefs {
  types: Record<PushTypeKey, boolean>;
  quietStart: string;
  quietEnd: string;
  dailyCapPerType: number;
  digestBundle: boolean;
  showDetails: boolean;
  digestSentDate: string;
}

interface Device {
  id: string;
  endpoint: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt: string;
}

const TYPE_LABELS: { key: PushTypeKey; label: string; hint: string }[] = [
  { key: "meeting60", label: "Meeting in about an hour", hint: "When a meeting with a Directory contact starts within the hour." },
  { key: "eventReminder", label: "Event reminders", hint: "The per-event alarms you set on calendar events (15 minutes before, 30 minutes, etc.)." },
  { key: "followups", label: "Follow-ups due", hint: "Follow-ups due today or overdue (one alert per day)." },
  { key: "fitSignals", label: "New fit targets with signals", hint: "New fit targets carrying two or more owner-transition signals." },
  { key: "newListing", label: "New businesses for sale", hint: "New Arizona listings in a focus sector that pass the size screen." },
  { key: "stalled", label: "Deals stalled", hint: "A deal with no movement in its stage for 30+ days." },
  { key: "quiet60_90", label: "Contacts going quiet", hint: "Operators and investors with no touch in 60 days, and again at 90." },
  { key: "competingBuyer", label: "Competing-buyer acquisitions", hint: "A known repeat acquirer makes another acquisition in our sectors." },
  { key: "feedDown", label: "Data feed stopped", hint: "A market-data feed has not updated in over 48 hours." },
];

const cardCls =
  "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]";
const headingCls = "text-sm font-semibold text-[#0d1f3c] dark:text-white";
const hintCls = "text-xs text-slate-500 dark:text-white/50";
const inputCls =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-[#0d1f3c] dark:border-white/15 dark:bg-white/5 dark:text-white";

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        on ? "bg-[#b8975a]" : "bg-slate-300 dark:bg-white/20"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          on ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

export default function PushSettings() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [testState, setTestState] = useState<string>("");
  const [standalone, setStandalone] = useState(true);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        fetch("/api/push/preferences").then((r) => r.json()),
        fetch("/api/push/subscribe").then((r) => r.json()),
      ]);
      if (p.preferences) setPrefs(p.preferences as Prefs);
      if (Array.isArray(s.subscriptions)) setDevices(s.subscriptions as Device[]);
    } catch {
      /* leave loading state to resolve below */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setStandalone(isStandalone);
  }, [load]);

  const save = async () => {
    if (!prefs) return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/push/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: prefs }),
      });
      const data = await res.json();
      if (data.preferences) {
        setPrefs(data.preferences as Prefs);
        setSaveState("saved");
      } else {
        setSaveState("error");
      }
    } catch {
      setSaveState("error");
    }
    setTimeout(() => setSaveState("idle"), 2500);
  };

  const sendTest = async () => {
    setTestState("Sending…");
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json();
      if (data.status === "sent") {
        setTestState(`Sent to ${data.delivered ?? 1} device${data.delivered === 1 ? "" : "s"}.`);
      } else if (data.error === "no active subscriptions") {
        setTestState("No device is registered yet — enable notifications in the installed app first.");
      } else {
        setTestState(`Not delivered: ${data.error ?? data.status ?? "unknown error"}`);
      }
    } catch {
      setTestState("Test failed — check your connection.");
    }
  };

  const removeDevice = async (endpoint: string) => {
    await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    }).catch(() => undefined);
    setDevices((d) => d.filter((x) => x.endpoint !== endpoint));
  };

  if (loading) {
    return <p className="text-sm text-slate-500 dark:text-white/50">Loading notification settings…</p>;
  }
  if (!prefs) {
    return (
      <p className="text-sm text-red-600 dark:text-red-300">
        Could not load notification settings. Refresh the page to try again.
      </p>
    );
  }

  const setType = (key: PushTypeKey, v: boolean) =>
    setPrefs((p) => (p ? { ...p, types: { ...p.types, [key]: v } } : p));

  return (
    <div className="space-y-5">
      {!standalone && (
        <div className="rounded-2xl border border-[#b8975a]/40 bg-[#b8975a]/10 p-4 text-sm text-slate-700 dark:text-[#e8dfc8]">
          Push notifications need the installed app. On iPhone: tap <strong>Share</strong>, then{" "}
          <strong>Add to Home Screen</strong>, and open the portal from the home-screen icon. On
          Android, use the browser&apos;s <strong>Install app</strong> prompt. Then return here to
          enable notifications on this device.
        </div>
      )}

      {/* Test + devices */}
      <section className={cardCls}>
        <h3 className={headingCls}>Notifications on this device</h3>
        <p className={`mt-1 ${hintCls}`}>
          Send a test to confirm delivery, and manage the devices registered for your account.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={sendTest}
            className="rounded-lg bg-[#0d1f3c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a3455] dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:hover:bg-[#d4b37a]"
          >
            Send test notification
          </button>
          {testState && <span className="text-sm text-slate-600 dark:text-white/70">{testState}</span>}
        </div>
        <div className="mt-4 space-y-2">
          {devices.length === 0 && (
            <p className={hintCls}>No devices registered yet.</p>
          )}
          {devices.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 dark:border-white/10"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[#0d1f3c] dark:text-white">
                  {d.deviceName || "Unnamed device"}
                </p>
                <p className={hintCls}>
                  Last seen {new Date(d.lastSeenAt).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeDevice(d.endpoint)}
                className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/5"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Per-type toggles */}
      <section className={cardCls}>
        <h3 className={headingCls}>What to notify about</h3>
        <div className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
          {TYPE_LABELS.map(({ key, label, hint }) => (
            <div key={key} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium text-[#0d1f3c] dark:text-white">{label}</p>
                <p className={hintCls}>{hint}</p>
              </div>
              <Toggle label={label} on={prefs.types[key]} onChange={(v) => setType(key, v)} />
            </div>
          ))}
        </div>
      </section>

      {/* Timing + bundling */}
      <section className={cardCls}>
        <h3 className={headingCls}>Timing &amp; bundling</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
              Quiet hours start
            </span>
            <input
              type="time"
              className={`${inputCls} mt-1 w-full`}
              value={prefs.quietStart}
              onChange={(e) => setPrefs({ ...prefs, quietStart: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
              Quiet hours end
            </span>
            <input
              type="time"
              className={`${inputCls} mt-1 w-full`}
              value={prefs.quietEnd}
              onChange={(e) => setPrefs({ ...prefs, quietEnd: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
              Daily cap per type
            </span>
            <input
              type="number"
              min={1}
              max={50}
              className={`${inputCls} mt-1 w-full`}
              value={prefs.dailyCapPerType}
              onChange={(e) =>
                setPrefs({ ...prefs, dailyCapPerType: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })
              }
            />
          </label>
        </div>
        <p className={`mt-2 ${hintCls}`}>
          During quiet hours (Phoenix time) alerts are held back; the daily cap limits how many
          alerts of each type can arrive in one day.
        </p>
        <div className="mt-4 flex items-center justify-between gap-4 border-t border-slate-100 pt-4 dark:border-white/5">
          <div>
            <p className="text-sm font-medium text-[#0d1f3c] dark:text-white">Morning digest bundle</p>
            <p className={hintCls}>
              Bundle new targets, listings, and competing-buyer alerts into one 8 AM digest
              instead of individual alerts.
            </p>
          </div>
          <Toggle
            label="Morning digest bundle"
            on={prefs.digestBundle}
            onChange={(v) => setPrefs({ ...prefs, digestBundle: v })}
          />
        </div>
      </section>

      {/* Privacy */}
      <section className={cardCls}>
        <h3 className={headingCls}>Lock-screen privacy</h3>
        <div className="mt-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[#0d1f3c] dark:text-white">Show details on lock screen</p>
            <p className={hintCls}>
              Off by default: notifications say things like “New fit target in Aerospace &amp;
              Defense” — never company names, people, or dollar amounts. Turn this on to include
              those details in the notification text.
            </p>
          </div>
          <Toggle
            label="Show details on lock screen"
            on={prefs.showDetails}
            onChange={(v) => setPrefs({ ...prefs, showDetails: v })}
          />
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saveState === "saving"}
          className="rounded-lg bg-[#0d1f3c] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1a3455] disabled:opacity-50 dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:hover:bg-[#d4b37a]"
        >
          {saveState === "saving" ? "Saving…" : "Save settings"}
        </button>
        {saveState === "saved" && (
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-300">Saved ✓</span>
        )}
        {saveState === "error" && (
          <span className="text-sm font-medium text-red-600 dark:text-red-300">Save failed — try again.</span>
        )}
      </div>
    </div>
  );
}
