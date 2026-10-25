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
import { Button } from "@/components/ui";
import {
  COMMS_API,
  api,
  inputCls,
  labelCls,
  type CommsStatus,
  type Rec,
  type ReportContactSettings,
} from "@/components/comms/types";

type TabKey = "reports" | "templates" | "schedules" | "settings";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "reports", label: "Reports" },
  { key: "templates", label: "Templates" },
  { key: "schedules", label: "Schedules" },
  { key: "settings", label: "Delivery settings" },
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
        {tab === "settings" && <DeliverySettingsPanel />}
      </div>
      </div>
    </div>
  );
}

/**
 * Delivery settings (Report redesign, Oct 24, 2026): the sender
 * identity printed on delivered reports (contact block + "Prepared
 * by") and the optional scheduling link behind the recipient's
 * "Request a call" button. Empty scheduling link = the option is
 * omitted from recipient pages; a URL is never invented.
 */
function DeliverySettingsPanel() {
  const [form, setForm] = useState<ReportContactSettings>({
    senderName: "",
    senderEmail: "",
    senderPhone: "",
    schedulingUrl: "",
  });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const data = await api<{ settings: ReportContactSettings }>(
          `${COMMS_API}/report-settings`
        );
        if (data.settings) setForm(data.settings);
      } catch {
        setError("Settings could not be loaded.");
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setNote("");
    setError("");
    try {
      const data = await api<{ settings: ReportContactSettings }>(
        `${COMMS_API}/report-settings`,
        { method: "PUT", body: JSON.stringify(form) }
      );
      if (data.settings) setForm(data.settings);
      setNote("Saved. New deliveries and report downloads use these details.");
    } catch {
      setError(
        "Could not save — check the email address and that the scheduling link starts with https://."
      );
    } finally {
      setBusy(false);
    }
  };

  const field = (
    key: keyof ReportContactSettings,
    label: string,
    placeholder: string,
    hint?: string
  ) => (
    <div>
      <label className={labelCls} htmlFor={`rs-${key}`}>
        {label}
      </label>
      <input
        id={`rs-${key}`}
        className={inputCls}
        value={form[key]}
        placeholder={placeholder}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
      {hint && (
        <p className="mt-1 text-xs text-slate-400 dark:text-white/40">{hint}</p>
      )}
    </div>
  );

  return (
    <section className="card-surface p-5" aria-label="Report delivery settings">
      <h3 className="font-display text-xl font-semibold text-navy-900 dark:text-white">
        Report delivery settings
      </h3>
      <p className="mt-0.5 max-w-2xl text-sm text-slate-500 dark:text-white/50">
        Shown on every delivered report: the sender&apos;s name in the
        header and contact block, and the contact details recipients
        use for questions. The scheduling link powers the
        recipient&apos;s “Request a call” button — leave it empty and
        the button simply doesn&apos;t appear.
      </p>
      {!loaded ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-white/50">Loading…</p>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {field("senderName", "Sender name", "e.g. Ethan Canny")}
            {field("senderEmail", "Sender email", "e.g. ethan@cannycapitalpartners.com")}
            {field("senderPhone", "Sender phone", "Optional")}
            {field(
              "schedulingUrl",
              "Scheduling link",
              "https://…",
              "Your calendar booking link. Optional — never shown unless set."
            )}
          </div>
          {note && (
            <p className="mt-3 rounded-xl bg-slate-500/10 px-4 py-3 text-sm text-slate-700 dark:text-white/80">
              {note}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          )}
          <div className="mt-4 flex justify-end">
            <Button variant="primary" size="sm" className="min-h-[44px]" onClick={() => void save()} loading={busy} disabled={busy}>
              Save delivery settings
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
