"use client";

/**
 * CommunicationsHome — Part 12 landing: an honest status strip (AI
 * provider + email transport, rendered EXACTLY as /status reports —
 * including setup steps when a provider is setup_required) over the
 * Reports | Templates | Schedules tabs.
 */

import { useCallback, useEffect, useState } from "react";
import PageHero from "@/components/PageHero";
import { SkeletonRows } from "@/components/ui";
import ReportsList from "@/components/comms/ReportsList";
import TemplatesList from "@/components/comms/TemplatesList";
import SchedulesPanel from "@/components/comms/SchedulesPanel";
import {
  COMMS_API,
  api,
  type CommsStatus,
  type Rec,
} from "@/components/comms/types";

type TabKey = "reports" | "templates" | "schedules";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "reports", label: "Reports" },
  { key: "templates", label: "Templates" },
  { key: "schedules", label: "Schedules" },
];

function StatusCard({
  title,
  stateLabel,
  stateClass,
  detail,
  setupSteps,
}: {
  title: string;
  stateLabel: string;
  stateClass: string;
  detail?: string;
  setupSteps?: string[];
}) {
  return (
    <div className="card-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="micro-label">{title}</p>
        <span className={`badge ${stateClass}`}>{stateLabel}</span>
      </div>
      {detail && (
        <p className="mt-2 text-sm text-slate-600 dark:text-white/70">{detail}</p>
      )}
      {setupSteps && setupSteps.length > 0 && (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-amber-800 dark:text-amber-200">
          {setupSteps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function CommunicationsHome() {
  const [tab, setTab] = useState<TabKey>("reports");
  const [status, setStatus] = useState<CommsStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const data = await api<CommsStatus & Rec>(`${COMMS_API}/status`);
      setStatus(data);
      setStatusFailed(false);
    } catch {
      setStatus(null);
      setStatusFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem("ccp-comms-tab") ?? "";
      if (TABS.some((t) => t.key === saved)) setTab(saved as TabKey);
    } catch {
      /* storage unavailable — default tab stands */
    }
  }, []);

  const selectTab = (t: TabKey) => {
    setTab(t);
    try {
      window.sessionStorage.setItem("ccp-comms-tab", t);
    } catch {
      /* storage unavailable — tab still switches */
    }
  };

  const ai = status?.ai;
  const email = status?.email;
  const counts = status?.counts ?? {};

  return (
    <div>
      {/* Same hero heading as the Directory (Ethan, Oct 23, 2026). */}
      <PageHero
        eyebrow="Canny Capital Partners"
        title="Reporting"
        subtitle="Reports assembled from live portal data, reviewed and approved before anything leaves the firm, and delivered through tracked recipient links"
      />
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">

      {/* Status strip — states rendered exactly as the API reports. */}
      <div className="mt-5">
        {!status && !statusFailed && <SkeletonRows rows={2} />}
        {statusFailed && (
          <div className="card-surface p-4">
            <p className="text-sm text-red-700 dark:text-red-300">
              Could not load the reporting status.{" "}
              <button type="button" className="font-semibold underline" onClick={() => void loadStatus()}>
                Retry
              </button>
            </p>
          </div>
        )}
        {status && (
          <div className="grid gap-4 md:grid-cols-2">
            <StatusCard
              title="AI narrative"
              stateLabel={
                ai?.configured
                  ? `Configured${ai.provider ? ` · ${ai.provider}` : ""}`
                  : "Setup required"
              }
              stateClass={ai?.configured ? "badge-fit" : "badge-warn"}
              detail={ai?.detail}
              setupSteps={ai && !ai.configured ? ai.setupSteps : undefined}
            />
            <StatusCard
              title="Email transport"
              stateLabel={
                !email
                  ? "Unknown"
                  : !email.connected
                    ? "Not connected"
                    : email.mailSend === "available"
                      ? "Mail.Send available"
                      : email.mailSend === "setup_required"
                        ? "Mail.Send setup required"
                        : "Mail.Send unknown"
              }
              stateClass={
                email?.connected && email.mailSend === "available"
                  ? "badge-fit"
                  : "badge-warn"
              }
              detail={email?.detail}
              setupSteps={
                email && email.mailSend === "setup_required"
                  ? email.setupSteps
                  : undefined
              }
            />
          </div>
        )}
        {status && Object.keys(counts).length > 0 && (
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 dark:text-white/40">
            {Object.entries(counts).map(([k, v]) => (
              <span key={k}>
                {k.replace(/_/g, " ")}: <span className="tnum font-semibold">{v}</span>
              </span>
            ))}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Reporting sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => selectTab(t.key)}
            className={`chip min-h-[44px] shrink-0 ${tab === t.key ? "chip-active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "reports" && <ReportsList />}
        {tab === "templates" && <TemplatesList />}
        {tab === "schedules" && <SchedulesPanel />}
      </div>
      </div>
    </div>
  );
}
