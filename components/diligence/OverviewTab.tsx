"use client";

/**
 * Overview — the redesigned workspace landing tab. Everything here
 * renders from the pre-aggregated workspace summary (server module):
 * workstream readiness, key dates, needs-attention, findings by
 * severity, the QoE EBITDA bridge, data room completeness, and the
 * recent activity feed. No per-page aggregation.
 */

import { useState } from "react";
import Link from "next/link";
import {
  WORKSTREAMS,
  api,
  fmtDateShort,
  fmtMoney,
  fmtSignedMoney,
  labelOf,
  type NavIntent,
  type SectionKey,
  type WorkspaceSummary,
} from "@/components/diligence/types";

const cardCls =
  "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#132847]/60";
const hCls =
  "text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

function Bar({ pct, tone }: { pct: number; tone?: string }) {
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
      <div
        className={`h-full rounded-full ${tone ?? "bg-[#b8975a]"}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

export default function OverviewTab({
  summary,
  navigate,
  reload,
}: {
  summary: WorkspaceSummary;
  navigate: (section: SectionKey, intent?: NavIntent) => void;
  reload: () => Promise<void>;
}) {
  const ws = summary.workspace;
  const [dates, setDates] = useState({
    loiDate: summary.keyDates.loiDate ?? "",
    exclusivityExpiry: summary.keyDates.exclusivityExpiry ?? "",
    targetCloseDate: summary.keyDates.targetCloseDate ?? "",
  });
  const [savingDates, setSavingDates] = useState(false);
  const [datesMsg, setDatesMsg] = useState("");

  const saveDates = async () => {
    if (savingDates) return;
    setSavingDates(true);
    setDatesMsg("");
    try {
      await api(`/api/platform/diligence/workspaces/${encodeURIComponent(ws.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          loiDate: dates.loiDate || null,
          exclusivityExpiry: dates.exclusivityExpiry || null,
          targetCloseDate: dates.targetCloseDate || null,
        }),
      });
      setDatesMsg("Saved.");
      await reload();
    } catch {
      setDatesMsg("Could not save — try again.");
    } finally {
      setSavingDates(false);
    }
  };

  const orderedStreams = [
    ...WORKSTREAMS.map((w) => summary.workstreams.find((s) => s.workstream === w.key)).filter(
      (s): s is NonNullable<typeof s> => Boolean(s)
    ),
    ...summary.workstreams.filter(
      (s) => !WORKSTREAMS.some((w) => w.key === s.workstream)
    ),
  ];
  const sev = summary.counts.findingsOpenBySeverity;
  const sevTotal = Math.max(1, sev.high + sev.medium + sev.low);
  const na = summary.needsAttention;
  const bridge = summary.bridge;
  const bridgeDelta =
    bridge && bridge.reportedEbitda !== null && bridge.adjustedEbitda !== null
      ? bridge.adjustedEbitda - bridge.reportedEbitda
      : null;

  const timeline: Array<{ label: string; date: string | null; past: boolean }> = [
    { label: "Diligence started", date: summary.keyDates.startedOn, past: true },
    { label: "LOI signed", date: summary.keyDates.loiDate, past: false },
    { label: "Exclusivity expiry", date: summary.keyDates.exclusivityExpiry, past: false },
    { label: "Target close", date: summary.keyDates.targetCloseDate, past: false },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        {/* Readiness by workstream */}
        <section className={cardCls}>
          <div className="flex items-center justify-between">
            <h3 className={hCls}>Readiness by workstream</h3>
            <button
              type="button"
              className="text-xs font-semibold text-[#8a6d3b] hover:underline dark:text-[#b8975a]"
              onClick={() => navigate("checklist")}
            >
              Open checklist →
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {orderedStreams.length === 0 && (
              <p className="text-sm text-slate-500 dark:text-white/50">
                No checklist items yet.
              </p>
            )}
            {orderedStreams.map((s) => (
              <div key={s.workstream} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-sm text-[#0d1f3c] dark:text-white/90">
                  {labelOf(WORKSTREAMS, s.workstream)}
                </span>
                <Bar pct={s.pct} />
                <span className="w-20 shrink-0 text-right text-xs text-slate-500 dark:text-white/50">
                  {s.done}/{s.total} · {s.pct}%
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Needs attention */}
        <section className={cardCls}>
          <h3 className={hCls}>Needs attention</h3>
          {na.overdueItems.length === 0 &&
            na.agingRequests.length === 0 &&
            na.highFindings.length === 0 && (
              <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
                Nothing overdue, aging, or high-severity right now.
              </p>
            )}
          <ul className="mt-2 divide-y divide-slate-100 dark:divide-white/5">
            {na.overdueItems.map((i) => (
              <li key={`o-${i.id}`}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 py-2 text-left hover:bg-slate-50 dark:hover:bg-white/5"
                  onClick={() => navigate("checklist", { checklist: "attention" })}
                >
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-500/20 dark:text-red-300">
                    Overdue {i.daysOverdue}d
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-[#0d1f3c] dark:text-white/90">
                    {i.title}
                  </span>
                  <span className="text-xs text-slate-400">
                    {labelOf(WORKSTREAMS, i.workstream)}
                    {i.owner ? ` · ${i.owner}` : ""}
                  </span>
                </button>
              </li>
            ))}
            {na.agingRequests.map((r) => (
              <li key={`r-${r.id}`}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 py-2 text-left hover:bg-slate-50 dark:hover:bg-white/5"
                  onClick={() => navigate("requests")}
                >
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                    Request · {r.daysOutstanding}d out
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-[#0d1f3c] dark:text-white/90">
                    {r.label}
                  </span>
                </button>
              </li>
            ))}
            {na.highFindings.map((f) => (
              <li key={`f-${f.id}`}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 py-2 text-left hover:bg-slate-50 dark:hover:bg-white/5"
                  onClick={() => navigate("findings", { findingsSeverity: "high" })}
                >
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-500/20 dark:text-red-300">
                    High finding
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-[#0d1f3c] dark:text-white/90">
                    {f.title}
                  </span>
                  {f.impactAmount !== null && (
                    <span className="text-xs font-semibold text-[#0d1f3c] dark:text-white/80">
                      {fmtMoney(f.impactAmount)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Activity */}
        <section className={cardCls}>
          <h3 className={hCls}>Recent activity</h3>
          {summary.activity.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
              No activity recorded yet.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {summary.activity.map((a) => (
                <li key={a.id} className="flex items-baseline gap-2 text-sm">
                  <span className="shrink-0 text-xs text-slate-400">
                    {fmtDateShort(a.createdAt)}
                  </span>
                  <span className="min-w-0 text-[#0d1f3c] dark:text-white/90">
                    {a.message}
                    {a.actor ? (
                      <span className="text-slate-400"> — {a.actor}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="space-y-4">
        {/* Key dates */}
        <section className={cardCls}>
          <h3 className={hCls}>Key dates</h3>
          <div className="mt-3 space-y-2">
            {timeline.map((t) => (
              <div key={t.label} className="flex items-center gap-2 text-sm">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    t.date ? "bg-[#b8975a]" : "bg-slate-300 dark:bg-white/20"
                  }`}
                />
                <span className="flex-1 text-[#0d1f3c] dark:text-white/90">{t.label}</span>
                <span className="text-xs text-slate-500 dark:text-white/50">
                  {t.date ? fmtDateShort(t.date) : "Not set"}
                </span>
              </div>
            ))}
            <p className="text-xs text-slate-400">
              {summary.keyDates.daysInDiligence} days in diligence
            </p>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 dark:border-white/5">
            {(
              [
                ["loiDate", "LOI date"],
                ["exclusivityExpiry", "Exclusivity expiry"],
                ["targetCloseDate", "Target close"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-white/50">
                {label}
                <input
                  type="date"
                  className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-[#0d1f3c] dark:border-white/10 dark:bg-white/5 dark:text-white"
                  value={dates[key]}
                  onChange={(e) => setDates((d) => ({ ...d, [key]: e.target.value }))}
                />
              </label>
            ))}
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={savingDates}
                onClick={() => void saveDates()}
              >
                {savingDates ? "Saving…" : "Save dates"}
              </button>
              {datesMsg && (
                <span className="text-xs text-slate-500 dark:text-white/50">{datesMsg}</span>
              )}
            </div>
          </div>
        </section>

        {/* Findings by severity */}
        <section className={cardCls}>
          <h3 className={hCls}>Findings by severity</h3>
          <div className="mt-3 space-y-2">
            {(
              [
                ["high", sev.high, "bg-red-500"],
                ["medium", sev.medium, "bg-amber-500"],
                ["low", sev.low, "bg-slate-400"],
              ] as const
            ).map(([key, count, tone]) => (
              <button
                key={key}
                type="button"
                className="flex w-full items-center gap-3"
                onClick={() => navigate("findings", { findingsSeverity: key })}
              >
                <span className="w-14 shrink-0 text-left text-sm capitalize text-[#0d1f3c] dark:text-white/90">
                  {key}
                </span>
                <Bar pct={(count / sevTotal) * 100} tone={tone} />
                <span className="w-8 shrink-0 text-right text-xs text-slate-500 dark:text-white/50">
                  {count}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-white/50">
            Cumulative open-findings impact:{" "}
            <span className="font-semibold text-[#0d1f3c] dark:text-white/85">
              {fmtMoney(summary.counts.findingsImpactTotal || null)}
            </span>
          </p>
        </section>

        {/* EBITDA bridge */}
        <section className={cardCls}>
          <h3 className={hCls}>EBITDA bridge</h3>
          {bridge ? (
            <div className="mt-2 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-white/50">Reported EBITDA</span>
                <span className="font-semibold text-[#0d1f3c] dark:text-white">
                  {fmtMoney(bridge.reportedEbitda)}
                </span>
              </div>
              {bridge.items.map((it, idx) => (
                <div key={idx} className="flex justify-between">
                  <span className="min-w-0 truncate text-slate-500 dark:text-white/50">
                    {it.label}
                  </span>
                  <span className="text-[#0d1f3c] dark:text-white/85">
                    {fmtSignedMoney(it.amount)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between border-t border-slate-100 pt-1.5 dark:border-white/5">
                <span className="text-slate-500 dark:text-white/50">Adjusted EBITDA</span>
                <span className="font-semibold text-[#0d1f3c] dark:text-white">
                  {fmtMoney(bridge.adjustedEbitda)}
                  {bridgeDelta !== null && (
                    <span className="ml-1 text-xs font-normal text-slate-400">
                      ({fmtSignedMoney(bridgeDelta)})
                    </span>
                  )}
                </span>
              </div>
              <button
                type="button"
                className="text-xs font-semibold text-[#8a6d3b] hover:underline dark:text-[#b8975a]"
                onClick={() => navigate("qoe")}
              >
                Open QoE workbench →
              </button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
              No QoE bridge yet — post a reported EBITDA set and adjustments
              in the QoE workbench.
            </p>
          )}
        </section>

        {/* Data room completeness */}
        <section className={cardCls}>
          <h3 className={hCls}>Data room completeness</h3>
          {summary.dataroom ? (
            <div className="mt-3">
              <div className="flex items-center gap-3">
                <Bar pct={summary.dataroom.pct} />
                <span className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
                  {summary.dataroom.pct}%
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-white/50">
                {summary.dataroom.satisfied} of {summary.dataroom.total}{" "}
                checklist items satisfied in {summary.dataroom.roomName}.
              </p>
              <Link
                href={`/data-rooms/${summary.dataroom.roomId}`}
                className="mt-1 inline-block text-xs font-semibold text-[#8a6d3b] hover:underline dark:text-[#b8975a]"
              >
                Open data room →
              </Link>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
              No data room linked to this deal yet.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
