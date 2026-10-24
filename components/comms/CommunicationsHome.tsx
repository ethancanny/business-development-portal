"use client";

/**
 * CommunicationsHome — Part 12 landing: the Reports | Templates |
 * Schedules tabs. (The AI/email setup-requirement cards that used to
 * sit above the tabs were removed at Ethan's direction, Oct 23, 2026
 * — provider state still lives in the send/generate paths and in
 * Settings -> Integrations; the /status counts line remains.)
 */

import { useCallback, useEffect, useState } from "react";
import PageHero from "@/components/PageHero";
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

export default function CommunicationsHome() {
  const [tab, setTab] = useState<TabKey>("reports");
  const [status, setStatus] = useState<CommsStatus | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const data = await api<CommsStatus & Rec>(`${COMMS_API}/status`);
      setStatus(data);
    } catch {
      setStatus(null);
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

      {/* Counts line (the setup-requirement cards were removed). */}
      <div className="mt-5">
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
