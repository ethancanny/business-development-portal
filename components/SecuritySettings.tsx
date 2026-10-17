"use client";

import { useCallback, useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";

/**
 * Security settings (CRM Phase 2, Oct 2026): passkey management,
 * idle auto-lock period, the device registry, sign-out-everywhere.
 * Data: /api/devices (devices + passkeys), /api/auth/session (lock
 * minutes), /api/webauthn/register/* (add a passkey).
 */

interface Device {
  id: string;
  kind: "session" | "passkey" | "push";
  label: string;
  createdAt: string;
  lastSeenAt: string;
  credentialLastUsedAt?: string | null;
  isCurrent?: boolean;
}

const LOCK_OPTIONS = [5, 15, 30, 60];

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#b8975a] focus:outline-none dark:border-white/15 dark:bg-[#0d1f3c] dark:text-[#e8dfc8] dark:placeholder:text-white/30";

const primaryBtn =
  "btn btn-primary";

const ghostBtn =
  "rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-[#b8975a]/60 disabled:opacity-50 dark:border-white/15 dark:text-white/70";

export default function SecuritySettings() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [lockMinutes, setLockMinutes] = useState(15);
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [devRes, sesRes] = await Promise.all([
        fetch("/api/devices"),
        fetch("/api/auth/session"),
      ]);
      if (devRes.ok) {
        const data = await devRes.json();
        setDevices(Array.isArray(data.devices) ? data.devices : []);
      }
      if (sesRes.ok) {
        const data = await sesRes.json();
        if (typeof data.lockMinutes === "number") setLockMinutes(data.lockMinutes);
      }
    } catch {
      /* leave defaults; sections render empty states */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const passkeys = devices.filter((d) => d.kind === "passkey");
  const sessions = devices.filter((d) => d.kind === "session");

  const addPasskey = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const optRes = await fetch("/api/webauthn/register/options", {
        method: "POST",
      });
      const options = await optRes.json().catch(() => ({}));
      if (!optRes.ok) {
        throw new Error(options.error || "Could not start passkey registration.");
      }
      const response = await startRegistration({ optionsJSON: options });
      const verRes = await fetch("/api/webauthn/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response,
          deviceName: deviceName.trim() || "Passkey",
        }),
      });
      const verData = await verRes.json().catch(() => ({}));
      if (!verRes.ok) {
        throw new Error(verData.error || "Passkey registration failed.");
      }
      setDeviceName("");
      setNotice("Passkey added. You can now sign in and unlock with it.");
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Passkey registration failed.";
      setError(
        `${msg} Hint: passkeys work best from the installed app (Add to Home Screen) on this device, over the portal's own address.`
      );
    }
    setBusy(false);
  };

  const revokePasskey = async (id: string, label: string) => {
    if (!window.confirm(`Remove the passkey “${label}”? It will no longer sign in or unlock the portal.`)) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/devices", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not remove the passkey.");
      setNotice("Passkey removed.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the passkey.");
    }
    setBusy(false);
  };

  const changeLockMinutes = async (minutes: number) => {
    setLockMinutes(minutes);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockMinutes: minutes }),
      });
      if (!res.ok) throw new Error("Could not save the auto-lock setting.");
      setNotice(`Auto-lock set to ${minutes} minutes. It takes effect on this device at the next page load.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the auto-lock setting.");
    }
  };

  const signOutEverywhere = async () => {
    if (
      !window.confirm(
        "Sign out on every device? All sessions — including this one — will need to sign in again."
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await fetch("/api/auth/sign-out-everywhere", { method: "POST" });
    } catch {
      /* redirect regardless */
    }
    window.location.href = "/login";
  };

  const lockNow = () => {
    window.dispatchEvent(new CustomEvent("ccp:lock"));
  };

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          {notice}
        </p>
      )}

      {/* Passkeys */}
      <section>
        <h3 className="text-base font-semibold text-[#0d1f3c] dark:text-white">
          Passkeys
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
          Sign in and unlock with Face ID, Touch ID, or your device PIN —
          no password to type. Passkeys are created on a device and stay
          on it (or in your platform keychain).
        </p>

        {loading ? (
          <p className="mt-4 text-sm text-slate-400 dark:text-white/40">Loading…</p>
        ) : passkeys.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400 dark:text-white/40">
            No passkeys registered yet. Add one below from each device you use.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-white/5 dark:border-white/10">
            {passkeys.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-[#0d1f3c] dark:text-white">
                    {p.label || "Passkey"}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-white/40">
                    Added {fmtDate(p.createdAt)} · Last used{" "}
                    {fmtDate(p.credentialLastUsedAt ?? p.lastSeenAt)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => revokePasskey(p.id, p.label || "Passkey")}
                  className={ghostBtn}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="Name this device (e.g. iPhone, Office Mac)"
            className={inputCls}
          />
          <button
            type="button"
            onClick={addPasskey}
            disabled={busy}
            className={`${primaryBtn} shrink-0`}
          >
            {busy ? "Working…" : "Add a passkey"}
          </button>
        </div>
      </section>

      {/* Auto-lock */}
      <section>
        <h3 className="text-base font-semibold text-[#0d1f3c] dark:text-white">
          Auto-lock
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
          When the app has been in the background this long, it locks and
          asks for your passkey (or password) before showing anything.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select
            value={lockMinutes}
            onChange={(e) => changeLockMinutes(Number(e.target.value))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#b8975a] focus:outline-none dark:border-white/15 dark:bg-[#0d1f3c] dark:text-[#e8dfc8]"
          >
            {LOCK_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
          <button type="button" onClick={lockNow} className={ghostBtn}>
            Lock now
          </button>
        </div>
      </section>

      {/* Devices */}
      <section>
        <h3 className="text-base font-semibold text-[#0d1f3c] dark:text-white">
          Devices
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
          Browsers that have signed in recently. Sessions can&apos;t be
          revoked one by one — use “Sign out everywhere” to end all of
          them at once. Passkeys can be removed individually above.
        </p>
        {loading ? (
          <p className="mt-4 text-sm text-slate-400 dark:text-white/40">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400 dark:text-white/40">
            No signed-in devices recorded yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-white/5 dark:border-white/10">
            {sessions.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-[#0d1f3c] dark:text-white">
                    {d.label || "Browser session"}
                    {d.isCurrent && (
                      <span className="ml-2 rounded-full bg-[#b8975a]/15 px-2 py-0.5 text-[11px] font-semibold text-[#8a6f3c] dark:text-[#d4b37a]">
                        This device
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-white/40">
                    Last seen {fmtDate(d.lastSeenAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <button
            type="button"
            onClick={signOutEverywhere}
            disabled={busy}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            Sign out everywhere
          </button>
          <p className="mt-2 text-xs text-slate-400 dark:text-white/40">
            Ends every session on every device, including this one.
            Passkeys stay registered; passwords/passkeys will be needed
            to sign back in.
          </p>
        </div>
      </section>
    </div>
  );
}
