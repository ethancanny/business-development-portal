"use client";

/**
 * Due Diligence workspace shell — REDESIGNED Oct 2026 (density pass).
 *
 * Structure: identity header (below the standalone deal banner the
 * identity build mounts above this page) → six clickable summary
 * tiles fed by the pre-aggregated workspace summary → grouped
 * navigation (six groups, sub-sections as wrapping chips — never a
 * horizontally scrolling nav) → the active section only. Section
 * data is fetched per tab; the shell itself loads only the resolve
 * call + the summary aggregate.
 *
 * Every pre-redesign tab lives on under the groups:
 *   Overview (new) · Workplan: Checklist, Requests, Seller Q&A ·
 *   Financial & Tax: QoE Workbench, Financial Analysis, Tax ·
 *   Business & Legal: Contracts, Licenses, Site Visits, Process
 *   Maps, Scorecard · Risk & Terms: Findings & Terms, Red Flags,
 *   Risk Score · Documents & Closing: Doc Intel, Record Checks,
 *   Closing, IC Memo.
 * Old ?tab= deep links map onto the same section keys.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ErrorState, SkeletonRows } from "@/components/ui";
import {
  ApiError,
  api,
  fmtDateShort,
  fmtMoney,
  type NavIntent,
  type SectionKey,
  type WorkspaceRow,
  type WorkspaceSummary,
} from "@/components/diligence/types";
import OverviewTab from "@/components/diligence/OverviewTab";
import ChecklistTab from "@/components/diligence/ChecklistTab";
import RequestsTab from "@/components/diligence/RequestsTab";
import SellerQaTab from "@/components/diligence/SellerQaTab";
import QoeTab from "@/components/diligence/QoeTab";
import FindingsTab from "@/components/diligence/FindingsTab";
import ContractsTab from "@/components/diligence/ContractsTab";
import LicensesTab from "@/components/diligence/LicensesTab";
import TaxTab from "@/components/diligence/TaxTab";
import ScorecardTab from "@/components/diligence/ScorecardTab";
import SiteVisitsTab from "@/components/diligence/SiteVisitsTab";
import RedFlagsTab from "@/components/diligence/RedFlagsTab";
import ClosingTab from "@/components/diligence/ClosingTab";
import BpmnTab from "@/components/diligence/BpmnTab";
import DocIntTab from "@/components/diligence/DocIntTab";
import RecordsTab from "@/components/diligence/RecordsTab";
import MemoTab from "@/components/diligence/MemoTab";
import RiskTab from "@/components/diligence/RiskTab";
import DataRoomButton from "@/components/hubs/DataRoomButton";
import GenerateReportButton from "@/components/comms/GenerateReportButton";

interface SectionDef {
  key: SectionKey;
  label: string;
}

interface GroupDef {
  key: string;
  label: string;
  sections: SectionDef[];
}

const GROUPS: GroupDef[] = [
  { key: "overview", label: "Overview", sections: [{ key: "overview", label: "Overview" }] },
  {
    key: "workplan",
    label: "Workplan",
    sections: [
      { key: "checklist", label: "Checklist" },
      { key: "requests", label: "Requests" },
      { key: "qa", label: "Seller Q&A" },
    ],
  },
  {
    key: "financial",
    label: "Financial & Tax",
    sections: [
      { key: "qoe", label: "QoE Workbench" },
      { key: "analysis", label: "Financial Analysis" },
      { key: "tax", label: "Tax" },
    ],
  },
  {
    key: "business",
    label: "Business & Legal",
    sections: [
      { key: "contracts", label: "Contracts" },
      { key: "licenses", label: "Licenses" },
      { key: "site-visits", label: "Site Visits" },
      { key: "bpmn", label: "Process Maps" },
      { key: "scorecard", label: "Scorecard" },
    ],
  },
  {
    key: "risk",
    label: "Risk & Terms",
    sections: [
      { key: "findings", label: "Findings & Terms" },
      { key: "red-flags", label: "Red Flags" },
      { key: "risk", label: "Risk Score" },
    ],
  },
  {
    key: "documents",
    label: "Documents & Closing",
    sections: [
      { key: "docint", label: "Doc Intel" },
      { key: "records", label: "Record Checks" },
      { key: "closing", label: "Closing" },
      { key: "memo", label: "IC Memo" },
    ],
  },
];

const SECTION_GROUP: Record<SectionKey, string> = Object.fromEntries(
  GROUPS.flatMap((g) => g.sections.map((s) => [s.key, g.key]))
) as Record<SectionKey, string>;

const INVESTMENT_TYPE_LABELS: Record<string, string> = {
  platform_lbo: "Platform LBO",
  addon: "Add-on",
  early_stage: "Early Stage",
  minority_growth: "Minority Growth",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")
  ).toUpperCase();
}

function initialSection(): SectionKey {
  if (typeof window === "undefined") return "overview";
  const raw =
    new URLSearchParams(window.location.search).get("section") ??
    new URLSearchParams(window.location.search).get("tab");
  if (raw && raw in SECTION_GROUP) return raw as SectionKey;
  return "overview";
}

export default function DiligenceWorkspace({ dealId }: { dealId: string }) {
  const [workspace, setWorkspace] = useState<WorkspaceRow | null>(null);
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "none" | "error">(
    "loading"
  );
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [section, setSection] = useState<SectionKey>("overview");
  const [intent, setIntent] = useState<NavIntent | null>(null);

  useEffect(() => {
    setSection(initialSection());
  }, []);

  const loadSummary = useCallback(async (workspaceId: string) => {
    const data = await api<WorkspaceSummary>(
      `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/summary`
    );
    setSummary(data);
    setWorkspace(data.workspace);
  }, []);

  const resolve = useCallback(async () => {
    setPhase("loading");
    try {
      const data = await api<{ workspace: WorkspaceRow }>(
        `/api/platform/diligence/workspaces?dealId=${encodeURIComponent(dealId)}`
      );
      await loadSummary(data.workspace.id);
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setPhase("none");
      } else {
        setPhase("error");
      }
    }
  }, [dealId, loadSummary]);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  const reload = useCallback(async () => {
    if (workspace) await loadSummary(workspace.id);
  }, [workspace, loadSummary]);

  const navigate = useCallback((next: SectionKey, navIntent?: NavIntent) => {
    setIntent(navIntent ?? null);
    setSection(next);
  }, []);

  const start = async () => {
    if (starting) return;
    setStarting(true);
    setStartError("");
    try {
      const data = await api<{ workspace: WorkspaceRow }>(
        "/api/platform/diligence/workspaces",
        { method: "POST", body: JSON.stringify({ dealId }) }
      );
      await loadSummary(data.workspace.id);
      setPhase("ready");
    } catch {
      setStartError("Could not start diligence for this deal. Please try again.");
    } finally {
      setStarting(false);
    }
  };

  const group = useMemo(
    () => GROUPS.find((g) => g.key === SECTION_GROUP[section]) ?? GROUPS[0],
    [section]
  );

  if (phase === "loading") return <SkeletonRows rows={6} />;
  if (phase === "error") return <ErrorState onRetry={() => void resolve()} />;

  if (phase === "none" || !workspace) {
    return (
      <div className="card-surface flex flex-col items-center px-6 py-12 text-center">
        <p className="font-display text-2xl font-semibold text-navy-900 dark:text-white">
          No diligence workspace for this deal yet
        </p>
        <p className="caption mt-2 max-w-md">
          Starting diligence creates the workspace and seeds the standard
          checklist, controls scorecard, tax profile and the five as-is
          process maps.
        </p>
        {startError && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-300">{startError}</p>
        )}
        <button
          type="button"
          className="btn btn-primary mt-5"
          disabled={starting}
          onClick={() => void start()}
        >
          {starting ? "Starting…" : "Start diligence"}
        </button>
        <Link href="/due-diligence" className="btn btn-ghost btn-sm mt-3">
          ← All deals
        </Link>
      </div>
    );
  }

  if (!summary) return <SkeletonRows rows={6} />;

  const deal = summary.deal;
  const counts = summary.counts;
  const value = deal?.askingPrice ?? deal?.dealValue ?? null;
  const multiple =
    value && deal?.ebitda ? (value / deal.ebitda).toFixed(1) : null;
  const sev = counts.findingsOpenBySeverity;
  const slim = {
    workspace: summary.workspace,
    deal: summary.deal,
    room: summary.room,
    counts,
  };
  const tabProps = {
    workspaceId: workspace.id,
    bundle: slim,
    reload,
    navigate,
    intent,
  };

  const tiles: Array<{
    label: string;
    display: string;
    caption: string;
    go: () => void;
  }> = [
    {
      label: "Checklist",
      display: `${counts.checklistPct}%`,
      caption: `${counts.checklistDone} of ${counts.checklistTotal} complete`,
      go: () => navigate("checklist"),
    },
    {
      label: "Requests outstanding",
      display: String(counts.requestsOutstanding),
      caption: "Awaiting the seller / data room",
      go: () => navigate("requests"),
    },
    {
      label: "Open findings",
      display: String(sev.high + sev.medium + sev.low),
      caption: `${sev.high} high · ${sev.medium} med · ${sev.low} low`,
      go: () => navigate("findings"),
    },
    {
      label: "Open red flags",
      display: String(counts.redFlagsOpen),
      caption:
        counts.redFlagsCandidate > 0
          ? `+ ${counts.redFlagsCandidate} candidate(s) to review`
          : "No candidates waiting",
      go: () =>
        navigate("red-flags", {
          redFlagsStatus: counts.redFlagsCandidate > 0 ? "candidate" : "open",
        }),
    },
    {
      label: "Findings price impact",
      display: fmtMoney(counts.findingsImpactTotal || null),
      caption: "Cumulative $ impact of open findings",
      go: () => navigate("findings"),
    },
    {
      label: "Closing items open",
      display: String(counts.closingOpen),
      caption: `${counts.findingsProposed} proposed finding term(s)`,
      go: () => navigate("closing"),
    },
  ];

  const chipBadge = (key: SectionKey): number | null =>
    key === "red-flags" && counts.redFlagsCandidate > 0
      ? counts.redFlagsCandidate
      : key === "requests" && counts.requestsOutstanding > 0
        ? counts.requestsOutstanding
        : null;

  return (
    <div>
      {/* Header — sits below the deal banner mount point. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/due-diligence"
            className="text-xs font-semibold uppercase tracking-wider text-gold-700 hover:underline dark:text-gold-400"
          >
            ← Due Diligence
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="truncate font-display text-3xl font-semibold text-[#0d1f3c] dark:text-white">
              {deal?.companyName || deal?.dealName || "Deal workspace"}
            </h2>
            {deal?.investmentType && (
              <span className="rounded-full bg-[#0d1f3c] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white dark:bg-white/10">
                {INVESTMENT_TYPE_LABELS[deal.investmentType] ??
                  deal.investmentType}
              </span>
            )}
            {deal?.stage && (
              <span className="rounded-full border border-[#b8975a] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[#8a6d3b] dark:text-[#b8975a]">
                {deal.stage}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
            {value ? `Value ${fmtMoney(value)}` : "Value —"}
            {deal?.ebitda ? ` · EBITDA ${fmtMoney(deal.ebitda)}` : ""}
            {multiple ? ` · ${multiple}×` : ""}
            {` · ${summary.keyDates.daysInDiligence} days in diligence`}
            {summary.keyDates.targetCloseDate
              ? ` · Target close ${fmtDateShort(summary.keyDates.targetCloseDate)}`
              : ""}
            {` · Workspace ${workspace.status}`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap gap-2">
            <DataRoomButton dealId={dealId} />
            <GenerateReportButton
              subjectKind="deal"
              dealId={dealId}
              companyId={workspace.companyId ?? undefined}
            />
          </div>
          {summary.team.length > 0 && (
            <div className="flex items-center gap-1.5" title={summary.team.join(", ")}>
              {summary.team.slice(0, 6).map((name) => (
                <span
                  key={name}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0d1f3c] text-[10px] font-bold text-white ring-2 ring-white dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:ring-[#0d1f3c]"
                >
                  {initials(name)}
                </span>
              ))}
              <span className="ml-1 text-xs text-slate-500 dark:text-white/50">
                Deal team
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Clickable summary tiles (pre-aggregated summary). */}
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={t.go}
            className="card-surface p-4 text-left transition hover:ring-2 hover:ring-[#b8975a]/60"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
              {t.label}
            </div>
            <div className="mt-1 text-2xl font-semibold text-[#0d1f3c] dark:text-white">
              {t.display}
            </div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-white/50">
              {t.caption}
            </div>
          </button>
        ))}
      </div>

      {/* Grouped navigation — wraps, never scrolls horizontally. */}
      <div className="mt-6">
        <div className="hidden flex-wrap gap-1.5 md:flex" role="tablist" aria-label="Diligence groups">
          {GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => navigate(g.sections[0].key)}
              className={`chip ${group.key === g.key ? "chip-active" : ""}`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="md:hidden">
          <label className="sr-only" htmlFor="dd-group-select">
            Diligence group
          </label>
          <select
            id="dd-group-select"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5 dark:text-white"
            value={group.key}
            onChange={(e) => {
              const g = GROUPS.find((x) => x.key === e.target.value);
              if (g) navigate(g.sections[0].key);
            }}
          >
            {GROUPS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Diligence sections">
          {group.sections.map((s) => {
            const active = section === s.key;
            const badge = chipBadge(s.key);
            return (
              <button
                key={s.key}
                role="tab"
                aria-selected={active}
                onClick={() => navigate(s.key)}
                className={`chip shrink-0 ${active ? "chip-active" : ""}`}
              >
                {s.label}
                {badge !== null && (
                  <span className="ml-1.5 rounded-full bg-[#b8975a] px-1.5 text-[11px] font-bold text-white">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-5">
        {section === "overview" && (
          <OverviewTab summary={summary} navigate={navigate} reload={reload} />
        )}
        {section === "checklist" && <ChecklistTab {...tabProps} />}
        {section === "requests" && <RequestsTab {...tabProps} />}
        {section === "qa" && <SellerQaTab {...tabProps} />}
        {section === "qoe" && <QoeTab {...tabProps} view="workbench" />}
        {section === "analysis" && <QoeTab {...tabProps} view="analysis" />}
        {section === "findings" && <FindingsTab {...tabProps} />}
        {section === "contracts" && <ContractsTab {...tabProps} />}
        {section === "licenses" && <LicensesTab {...tabProps} />}
        {section === "tax" && <TaxTab {...tabProps} />}
        {section === "scorecard" && <ScorecardTab {...tabProps} />}
        {section === "site-visits" && <SiteVisitsTab {...tabProps} />}
        {section === "red-flags" && <RedFlagsTab {...tabProps} />}
        {section === "closing" && <ClosingTab {...tabProps} />}
        {section === "bpmn" && <BpmnTab {...tabProps} />}
        {section === "docint" && <DocIntTab {...tabProps} />}
        {section === "records" && <RecordsTab {...tabProps} />}
        {section === "memo" && <MemoTab {...tabProps} />}
        {section === "risk" && <RiskTab {...tabProps} />}
      </div>
    </div>
  );
}
