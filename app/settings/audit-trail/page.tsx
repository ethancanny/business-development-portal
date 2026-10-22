"use client";

/**
 * Settings → Audit Trail (Navigation Restructure): admin-gated. The
 * role is resolved from /api/auth/me; non-admins get a clear
 * access-denied card and the AuditTrailView (and its data fetch) is
 * never mounted for them.
 */

import { useEffect, useState } from "react";
import PageHero from "@/components/PageHero";
import SettingsNav from "@/components/settings/SettingsNav";
import AuditTrailView from "@/components/settings/AuditTrailView";

type Gate = "loading" | "admin" | "denied";

export default function SettingsAuditTrailPage() {
  const [gate, setGate] = useState<Gate>("loading");

  useEffect(() => {
    let live = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live) return;
        const role =
          (d as { role?: string } | null)?.role ??
          (d as { user?: { role?: string } } | null)?.user?.role;
        setGate(role === "admin" ? "admin" : "denied");
      })
      .catch(() => {
        if (live) setGate("denied");
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div>
      <PageHero
        eyebrow="Canny Capital Partners"
        title="Audit Trail"
        subtitle="The full history of changes across the platform."
      />
      <SettingsNav />
      <main className="mx-auto max-w-[900px] px-4 py-6 sm:px-6">
        {gate === "loading" ? (
          <div className="flex min-h-[30vh] items-center justify-center">
            <p className="text-sm text-slate-500 dark:text-white/50">
              Checking access…
            </p>
          </div>
        ) : gate === "denied" ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-white/10 dark:bg-[#132847]">
            <p className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
              Admins only
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-white/60">
              The audit trail is restricted to platform admins. Your role
              does not include access to the full change history.
            </p>
          </div>
        ) : (
          <AuditTrailView />
        )}
      </main>
    </div>
  );
}
