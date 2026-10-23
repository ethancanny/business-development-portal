"use client";

/**
 * EsignSettingsCard (Phase 10) — Settings card for the e-signature
 * framework. Fetches GET /api/platform/docgen/status and renders the
 * provider state honestly in the DataRoomSettings card style:
 * setup-required with the missing env vars named and the setup
 * steps listed — never a fake "connected/sent" state. Live sending
 * is not implemented in this phase even when credentials exist.
 */

import { useCallback, useEffect, useState } from "react";
import { ErrorState, SkeletonRows } from "@/components/ui";

interface EsignStatus {
  provider: string;
  configured: boolean;
  setupRequired: boolean;
  missing: string[];
  detail: string;
  setupSteps: string[];
}

interface DocgenStatus {
  esign: EsignStatus;
  templateCount: number;
}

function dotClass(configured: boolean): string {
  return configured ? "bg-emerald-500" : "bg-slate-400";
}

export default function EsignSettingsCard() {
  const [status, setStatus] = useState<DocgenStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/platform/docgen/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DocgenStatus;
      setStatus(data);
    } catch {
      setError("E-signature status could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h3 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
        E-signature (DocuSign)
      </h3>
      <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
        Generated documents (LOI, NDA, consents) can be routed for
        e-signature once a provider is connected. This phase ships the
        framework only — no envelopes are sent live yet.
      </p>
      <div className="mt-3">
        {loading ? (
          <SkeletonRows rows={2} />
        ) : error ? (
          <ErrorState
            title="Could not load e-signature status"
            message={error}
            onRetry={() => void load()}
          />
        ) : !status ? (
          <p className="text-sm text-slate-400 dark:text-white/40">
            No e-signature provider is registered yet.
          </p>
        ) : (
          <div>
            <div className="flex items-start gap-3 py-3">
              <span
                aria-hidden
                className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(status.esign.configured)}`}
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-[#0d1f3c] dark:text-white">
                  DocuSign
                  <span className="text-xs font-medium capitalize text-slate-400 dark:text-white/40">
                    {status.esign.configured
                      ? "configured — live sending not yet implemented"
                      : "setup required"}
                  </span>
                </p>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-white/60">
                  {status.esign.detail}
                </p>
                <p className="mt-0.5 text-xs text-caption">
                  Document templates available: {status.templateCount}
                </p>
              </div>
            </div>

            {status.esign.setupRequired &&
              status.esign.missing.length > 0 && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                    Missing environment variables
                  </p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {status.esign.missing.map((v) => (
                      <li
                        key={v}
                        className="rounded-md bg-white/70 px-2 py-0.5 font-mono text-xs text-amber-900 dark:bg-white/10 dark:text-amber-100"
                      >
                        {v}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            {status.esign.setupSteps.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                  Setup steps
                </p>
                <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm text-slate-600 dark:text-white/70">
                  {status.esign.setupSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
