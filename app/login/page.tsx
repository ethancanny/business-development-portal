"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { useTheme } from "@/components/ThemeProvider";

export default function LoginPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
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
        router.replace("/overview");
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Login failed");
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setBusy(false);
  };

  const submitPasskey = async () => {
    setError("");
    if (!email.trim()) {
      setError("Enter your email first, then use the passkey button.");
      return;
    }
    setPasskeyBusy(true);
    try {
      const optRes = await fetch("/api/webauthn/auth/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const options = await optRes.json().catch(() => ({}));
      if (!optRes.ok) {
        setError(options.error || "No passkey available for this account.");
        setPasskeyBusy(false);
        return;
      }
      const response = await startAuthentication({ optionsJSON: options });
      const verRes = await fetch("/api/webauthn/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, response }),
      });
      if (verRes.ok) {
        router.replace("/overview");
        router.refresh();
      } else {
        const data = await verRes.json().catch(() => ({}));
        setError(data.error || "Passkey sign-in failed. Try your password.");
      }
    } catch {
      setError("Passkey sign-in was cancelled or is not available here.");
    }
    setPasskeyBusy(false);
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{
        backgroundImage:
          "linear-gradient(rgba(13,31,60,0.82), rgba(13,31,60,0.88)), url(https://cannycapitalpartners.com/arizona-desert-landscape.jpg)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-2xl dark:border-white/10 dark:bg-[#132847]/95 dark:backdrop-blur">
        <img
          src={theme === "dark" ? "https://cannycapitalpartners.com/canny-logo-white.png" : "https://cannycapitalpartners.com/canny-logo.png"}
          alt="Canny Capital Partners"
          className="h-12 w-auto"
        />
        <h1 className="mt-4 text-2xl font-bold text-[#0d1f3c] dark:text-white">
          Business Development Portal
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-[#c8bfa8]">
          Sign in to track your pipelines
        </p>

        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#c8bfa8]">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#b8975a] focus:outline-none dark:border-white/15 dark:bg-[#0d1f3c] dark:text-[#e8dfc8] dark:placeholder:text-white/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-[#c8bfa8]">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#b8975a] focus:outline-none dark:border-white/15 dark:bg-[#0d1f3c] dark:text-[#e8dfc8] dark:placeholder:text-white/30"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            data-loading={busy || undefined}
            className="btn btn-accent w-full"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-6 flex items-center gap-3">
          <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
          <span className="text-xs font-medium text-caption">
            or
          </span>
          <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
        </div>

        <button
          type="button"
          onClick={submitPasskey}
          disabled={passkeyBusy}
          className="btn btn-secondary mt-4 w-full"
          data-loading={passkeyBusy || undefined}
        >
          {passkeyBusy ? "Waiting for passkey…" : "Sign in with a passkey"}
        </button>
        <p className="caption mt-2 text-center">
          Uses Face ID, Touch ID, or your device PIN. Add a passkey from
          Settings after signing in.
        </p>
      </div>
    </div>
  );
}
