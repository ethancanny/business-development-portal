"use client";

/**
 * Due Diligence workspace shell (Phase 5) — resolves the workspace
 * for a deal, loads the full bundle, and hosts the section tabs.
 * The shell owns bundle state; tabs receive items + a reload
 * callback and re-fetch the bundle after every mutation.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ErrorState, SkeletonRows, StatTile } from "@/components/ui";
import {
  ApiError,
  api,
  type WorkspaceBundle,
  type WorkspaceRow,
} from "@/components/diligence/types";
import ChecklistTab from "@/components/diligence/ChecklistTab";
import RequestsTab from "@/components/diligence/RequestsTab";
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

const TABS = [
  { key: "checklist", label: "Checklist" },
  { key: "requests", label: "Requests" },
  { key: "qoe", label: "QoE Workbench" },
  { key: "findings", label: "Findings & Terms" },
  { key: "contracts", label: "Contracts" },
  { key: "licenses", label: "Licenses" },
  { key: "tax", label: "Tax" },
  { key: "scorecard", label: "Scorecard" },
  { key: "site-visits", label: "Site Visits" },
  { key: "red-flags", label: "Red Flags" },
  { key: "closing", label: "Closing" },
  { key: "bpmn", label: "Process Maps" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function DiligenceWorkspace({ dealId }: { dealId: string }) {
  const [workspace, setWorkspace] = useState<WorkspaceRow | null>(null);
  const [bundle, setBundle] = useState<WorkspaceBundle | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "none" | "error">(
    "loading"
  );
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [tab, setTab] = useState<TabKey>("checklist");

  const loadBundle = useCallback(async (workspaceId: string) => {
    const data = await api<WorkspaceBundle>(
      `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}`
    );
    setBundle(data);
    setWorkspace(data.workspace);
  }, []);

  const resolve = useCallback(async () => {
    setPhase("loading");
    try {
      const data = await api<{ workspace: WorkspaceRow }>(
        `/api/platform/diligence/workspaces?dealId=${encodeURIComponent(dealId)}`
      );
      await loadBundle(data.workspace.id);
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setPhase("none");
      } else {
        setPhase("error");
      }
    }
  }, [dealId, loadBundle]);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  const reload = useCallback(async () => {
    if (workspace) await loadBundle(workspace.id);
  }, [workspace, loadBundle]);

  const start = async () => {
    if (starting) return;
    setStarting(true);
    setStartError("");
    try {
      const data = await api<{ workspace: WorkspaceRow }>(
        "/api/platform/diligence/workspaces",
        { method: "POST", body: JSON.stringify({ dealId }) }
      );
      await loadBundle(data.workspace.id);
      setPhase("ready");
    } catch {
      setStartError("Could not start diligence for this deal. Please try again.");
    } finally {
      setStarting(false);
    }
  };

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

  if (!bundle) return <SkeletonRows rows={6} />;

  const deal = bundle.deal;
  const counts = bundle.counts;
  const pct =
    counts.checklistTotal > 0
      ? Math.round((counts.checklistDone / counts.checklistTotal) * 100)
      : 0;
  const tabProps = { workspaceId: workspace.id, bundle, reload };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/due-diligence"
            className="text-xs font-semibold uppercase tracking-wider text-gold-700 hover:underline dark:text-gold-400"
          >
            ← Due Diligence
          </Link>
          <h2 className="mt-1 truncate font-display text-3xl font-semibold text-[#0d1f3c] dark:text-white">
            {deal?.dealName || deal?.companyName || "Deal workspace"}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
            {deal?.companyName && deal.companyName !== deal.dealName
              ? `${deal.companyName} · `
              : ""}
            {deal?.stage ? `Stage: ${deal.stage} · ` : ""}
            Workspace {workspace.status}
          </p>
        </div>
        {bundle.room && (
          <Link
            href={`/data-rooms/${encodeURIComponent(bundle.room.id)}`}
            className="btn btn-secondary btn-sm"
          >
            Data room: {bundle.room.name}
          </Link>
        )}
      </div>

      {/* Progress tiles */}
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card-surface p-4">
          <StatTile
            label="Checklist"
            display={`${pct}%`}
            numericValue={pct}
            format={(n) => `${n}%`}
            caption={`${counts.checklistDone} of ${counts.checklistTotal} complete`}
          />
        </div>
        <div className="card-surface p-4">
          <StatTile
            label="Requests outstanding"
            display={String(counts.requestsOutstanding)}
            numericValue={counts.requestsOutstanding}
            format={(n) => String(n)}
            caption="Awaiting the seller / data room"
          />
        </div>
        <div className="card-surface p-4">
          <StatTile
            label="Open red flags"
            display={String(counts.redFlagsOpen)}
            numericValue={counts.redFlagsOpen}
            format={(n) => String(n)}
            caption={
              counts.redFlagsCandidate > 0
                ? `+ ${counts.redFlagsCandidate} candidate(s) to review`
                : "No candidates waiting"
            }
          />
        </div>
        <div className="card-surface p-4">
          <StatTile
            label="Closing items open"
            display={String(counts.closingOpen)}
            numericValue={counts.closingOpen}
            format={(n) => String(n)}
            caption={`${counts.findingsProposed} proposed finding term(s)`}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-1.5 overflow-x-auto pb-1" role="tablist">
        {TABS.map((t) => {
          const active = tab === t.key;
          const badge =
            t.key === "red-flags" && counts.redFlagsCandidate > 0
              ? counts.redFlagsCandidate
              : t.key === "requests" && counts.requestsOutstanding > 0
                ? counts.requestsOutstanding
                : null;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`chip shrink-0 ${active ? "chip-active" : ""}`}
            >
              {t.label}
              {badge !== null && (
                <span className="ml-1.5 rounded-full bg-[#b8975a] px-1.5 text-[11px] font-bold text-white">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {tab === "checklist" && <ChecklistTab {...tabProps} />}
        {tab === "requests" && <RequestsTab {...tabProps} />}
        {tab === "qoe" && <QoeTab {...tabProps} />}
        {tab === "findings" && <FindingsTab {...tabProps} />}
        {tab === "contracts" && <ContractsTab {...tabProps} />}
        {tab === "licenses" && <LicensesTab {...tabProps} />}
        {tab === "tax" && <TaxTab {...tabProps} />}
        {tab === "scorecard" && <ScorecardTab {...tabProps} />}
        {tab === "site-visits" && <SiteVisitsTab {...tabProps} />}
        {tab === "red-flags" && <RedFlagsTab {...tabProps} />}
        {tab === "closing" && <ClosingTab {...tabProps} />}
        {tab === "bpmn" && <BpmnTab {...tabProps} />}
      </div>
    </div>
  );
}
