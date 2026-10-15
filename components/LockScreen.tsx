"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

/**
 * Idle auto-lock (CRM Phase 2, Oct 2026). Mounted once by the app layout.
 *
 * - Fetches /api/auth/session once on mount: caches lockMinutes, and if
 *   the token's epoch is stale (signed out everywhere) redirects to
 *   /login. 401 means "not signed in" — the lock never engages.
 * - Locks after the app has spent lockMinutes in the BACKGROUND
 *   (visibilitychange). Foreground idle does not lock.
 * - Settings can force a lock via the "ccp:lock" window CustomEvent.
 * - Renders null when not locked — it never blocks content otherwise.
 */
export default function LockScreen() {
  const [locked, setLocked] = useState(false);
  const [mode, setMode] = useState<"passkey" | "password">("passkey");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const lockMinutesRef = useRef(15);
  const hiddenAtRef = useRef<number | null>(null);
  const optionsRef = useRef<PublicKeyCredentialRequestOptionsJSON | null>(null);
  const signedInRef = useRef(false);

  const fetchUnlockOptions = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/webauthn/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "options" }),
      });
      if (!res.ok) return false;
      optionsRef.current = (await res.json()) as PublicKeyCredentialRequestOptionsJSON;
      return true;
    } catch {
      return false;
    }
  }, []);

  const lock = useCallback(async () => {
    if (!signedInRef.current) return;
    setError("");
    setPassword("");
    setLocked(true);
    // Prefer passkey unlock; fall back to the password form when the user
    // has no passkey (options step answers 400).
    const hasPasskey = await fetchUnlockOptions();
    setMode(hasPasskey ? "passkey" : "password");
  }, [fetchUnlockOptions]);

  // Session check once on mount + lock triggers.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (!res.ok || cancelled) return; // not signed in → never lock
        const data = await res.json();
        if (cancelled) return;
        if (data.epochValid === false) {
          window.location.href = "/login";
          return;
        }
        signedInRef.current = true;
        if (typeof data.lockMinutes === "number" && data.lockMinutes > 0) {
          lockMinutesRef.current = data.lockMinutes;
        }
        if (data.user?.email) setEmail(String(data.user.email));
      } catch {
        /* offline / dev without DB — stay unlocked */
      }
    })();

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
      } else if (document.visibilityState === "visible") {
        const hiddenAt = hiddenAtRef.current;
        hiddenAtRef.current = null;
        if (hiddenAt !== null) {
          const awayMinutes = (Date.now() - hiddenAt) / 60000;
          if (awayMinutes >= lockMinutesRef.current) void lock();
        }
      }
    };
    const onLockEvent = () => void lock();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("ccp:lock", onLockEvent);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("ccp:lock", onLockEvent);
    };
  }, [lock]);

  const unlockWithPasskey = async () => {
    setBusy(true);
    setError("");
    try {
      if (!optionsRef.current) {
        const ok = await fetchUnlockOptions();
        if (!ok) {
          setMode("password");
          setError("No passkey is registered for this account. Use your password.");
          setBusy(false);
          return;
        }
      }
      const response = await startAuthentication({
        optionsJSON: optionsRef.current!,
      });
      optionsRef.current = null; // challenges are single-use
      const res = await fetch("/api/webauthn/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "verify", response }),
      });
      if (res.ok) {
        setLocked(false);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Passkey unlock failed. Try again.");
      }
    } catch {
      optionsRef.current = null;
      setError("Passkey unlock was cancelled or failed.");
    }
    setBusy(false);
  };

  const unlockWithPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        setPassword("");
        setLocked(false);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Incorrect password.");
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setBusy(false);
  };

  const signOut = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* redirect regardless */
    }
    window.location.href = "/login";
  };

  if (!locked) return null;

  const inputCls =
    "w-full rounded-lg border border-white/20 bg-[#0d1f3c]/80 px-3 py-2.5 text-sm text-[#e8dfc8] placeholder:text-white/30 focus:border-[#b8975a] focus:outline-none";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Portal locked"
      style={{
        backgroundImage:
          "linear-gradient(rgba(4,11,26,0.78), rgba(4,11,26,0.9)), url(https://cannycapitalpartners.com/arizona-desert-landscape.jpg)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0d1f3c]/90 p-8 shadow-2xl backdrop-blur">
        <img
          src="https://cannycapitalpartners.com/canny-logo-white.png"
          alt="Canny Capital Partners"
          className="h-11 w-auto"
        />
        <h2 className="mt-4 text-xl font-bold text-white">Portal locked</h2>
        <p className="mt-1 text-sm text-[#c8bfa8]">
          You were away for a while. Verify it&apos;s you to continue.
        </p>

        {error && (
          <p className="mt-4 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {mode === "passkey" ? (
          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={unlockWithPasskey}
              disabled={busy}
              className="rounded-lg bg-[#b8975a] px-4 py-2.5 text-sm font-semibold text-[#0d1f3c] transition hover:bg-[#d4b37a] disabled:opacity-50"
            >
              {busy ? "Waiting for passkey…" : "Unlock with passkey"}
            </button>
            <button
              type="button"
              onClick={() => {
                setError("");
                setMode("password");
              }}
              className="rounded-lg border border-white/20 px-4 py-2.5 text-sm font-medium text-[#e8dfc8] transition hover:border-[#b8975a]/60"
            >
              Use password instead
            </button>
          </div>
        ) : (
          <form onSubmit={unlockWithPassword} className="mt-6 flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-[#c8bfa8]">
                Password for {email || "your account"}
              </label>
              <input
                type="password"
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={inputCls}
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-[#b8975a] px-4 py-2.5 text-sm font-semibold text-[#0d1f3c] transition hover:bg-[#d4b37a] disabled:opacity-50"
            >
              {busy ? "Unlocking…" : "Unlock"}
            </button>
            <button
              type="button"
              onClick={async () => {
                setError("");
                const ok = await fetchUnlockOptions();
                if (ok) setMode("passkey");
                else setError("No passkey is registered for this account.");
              }}
              className="rounded-lg border border-white/20 px-4 py-2.5 text-sm font-medium text-[#e8dfc8] transition hover:border-[#b8975a]/60"
            >
              Use passkey instead
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={signOut}
          className="mt-5 w-full text-center text-xs text-white/50 underline-offset-2 hover:text-white/80 hover:underline"
        >
          Sign out of this device
        </button>
      </div>
    </div>
  );
}
