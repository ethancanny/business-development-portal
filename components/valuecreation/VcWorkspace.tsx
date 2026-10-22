"use client";

/**
 * Value Creation workspace shell (Phase 6) — resolves the plan for
 * a company (GET /plans, matched client-side on companyId), loads
 * the plan detail (plan + summary + initiatives), and hosts the
 * section tabs. The shell owns plan state; tabs receive the plan,
 * its initiatives and a reload callback, and re-fetch the detail
 * after mutations that move the summary. Tabs that own their own
 * collections fetch them on open — no polling anywhere.
 *
 * Tab selection persists per plan in sessionStorage (same pattern
 * as Market Intel's main tab).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, ErrorState, SkeletonRows, StatTile } from "@/components/ui";
import {
  API,
  api,
  fmtDateShort,
  fmtMoneyCompact,
  fmtMoneyN,
  fmtUpdated,
  inputCls,
  labelCls,
  listFrom,
  todayIso,
  type Initiative,
  type PlanDetail,
  type PlanListItem,
  type PlanSummary,
  type VcPlan,
} from "@/components/valuecreation/types";
import InitiativesTab from "@/components/valuecreation/InitiativesTab";
import TimelineTab from "@/components/valuecreation/TimelineTab";
import MatrixTab from "@/components/valuecreation/MatrixTab";
import PlaybooksTab from "@/components/valuecreation/PlaybooksTab";
import TreesTab from "@/components/valuecreation/TreesTab";
import ScenariosTab from "@/components/valuecreation/ScenariosTab";
import ProcessMapsTab from "@/components/valuecreation/ProcessMapsTab";
import AddonsTab from "@/components/valuecreation/AddonsTab";
import OrgTab from "@/components/valuecreation/OrgTab";
import TargetsTab from "@/components/valuecreation/TargetsTab";
import ExitTab from "@/components/valuecreation/ExitTab";
import DataRoomButton from "@/components/hubs/DataRoomButton";

const TABS = [
  { key: "initiatives", label: "Initiatives" },
  { key: "timeline", label: "100-Day Plan" },
  { key: "matrix", label: "Matrix" },
  { key: "playbooks", label: "Playbooks" },
  { key: "trees", label: "Driver Trees" },
  { key: "scenarios", label: "Scenarios" },
  { key: "process-maps", label: "Process Maps" },
  { key: "addons", label: "Add-ons" },
  { key: "org", label: "Org & Talent" },
  { key: "targets", label: "Targets" },
  { key: "exit", label: "Exit Readiness" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function VcWorkspace({ companyId }: { companyId: string }) {
  const [plan, setPlan] = useState<VcPlan | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [summary, setSummary] = useState<PlanSummary | null>(null);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "none" | "error">("loading");
  const [tab, setTab] = useState<TabKey>("initiatives");

  const [createForm, setCreateForm] = useState({ name: "", planStartDate: todayIso(), thesis: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const loadDetail = useCallback(async (planId: string) => {
    const data = await api<PlanDetail>(
      `${API}/plans/${encodeURIComponent(planId)}`
    );
    setPlan(data.plan);
    setSummary(data.summary ?? null);
    setInitiatives(Array.isArray(data.initiatives) ? data.initiatives : []);
  }, []);

  const resolve = useCallback(async () => {
    setPhase("loading");
    try {
      const data = await api<Record<string, unknown>>(
        `${API}/plans?companyId=${encodeURIComponent(companyId)}`
      );
      const items = listFrom<PlanListItem>(data, "items", "plans");
      const match = items.find((p) => p.companyId === companyId) ?? null;
      if (!match) {
        setPhase("none");
        return;
      }
      setCompanyName(match.companyName ?? "");
      await loadDetail(match.id);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [companyId, loadDetail]);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  /* Restore the session's tab for this plan. */
  useEffect(() => {
    if (!plan) return;
    try {
      const saved = window.sessionStorage.getItem(`ccp-vc-tab:${plan.id}`) ?? "";
      if (TABS.some((t) => t.key === saved)) setTab(saved as TabKey);
    } catch {
      /* storage unavailable — default tab stands */
    }
  }, [plan]);

  const selectTab = (t: TabKey) => {
    setTab(t);
    if (plan) {
      try {
        window.sessionStorage.setItem(`ccp-vc-tab:${plan.id}`, t);
      } catch {
        /* storage unavailable — tab still switches */
      }
    }
  };

  const reload = useCallback(async () => {
    if (plan) await loadDetail(plan.id);
  }, [plan, loadDetail]);

  const createPlan = async () => {
    if (creating) return;
    setCreating(true);
    setCreateError("");
    try {
      const data = await api<{ plan: VcPlan }>(`${API}/plans`, {
        method: "POST",
        body: JSON.stringify({
          companyId,
          name: createForm.name.trim() || undefined,
          planStartDate: createForm.planStartDate || undefined,
          thesis: createForm.thesis.trim() || undefined,
        }),
      });
      if (data.plan?.id) {
        await loadDetail(data.plan.id);
        setPhase("ready");
      } else {
        await resolve();
      }
    } catch {
      setCreateError("Could not create the plan. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  if (phase === "loading") return <SkeletonRows rows={6} />;
  if (phase === "error") return <ErrorState onRetry={() => void resolve()} />;

  if (phase === "none" || !plan) {
    return (
      <div className="card-surface px-6 py-10">
        <div className="mx-auto max-w-xl">
          <p className="text-center font-display text-2xl font-semibold text-navy-900 dark:text-white">
            No value creation plan for this company yet
          </p>
          <p className="caption mt-2 text-center">
            A plan anchors the investment thesis to initiatives, targets,
            scenarios and exit readiness for this portfolio company.
          </p>
          {createError && (
            <p role="alert" className="mt-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {createError}
            </p>
          )}
          <div className="mt-5 space-y-3 text-left">
            <div>
              <label className={labelCls}>Plan name (optional)</label>
              <input
                className={`${inputCls} min-h-[44px]`}
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Defaults to the company name + Value Creation Plan"
              />
            </div>
            <div>
              <label className={labelCls}>Plan start date</label>
              <input
                type="date"
                className={`${inputCls} min-h-[44px]`}
                value={createForm.planStartDate}
                onChange={(e) => setCreateForm((f) => ({ ...f, planStartDate: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelCls}>Investment thesis</label>
              <textarea
                className={`${inputCls} min-h-[80px]`}
                value={createForm.thesis}
                onChange={(e) => setCreateForm((f) => ({ ...f, thesis: e.target.value }))}
                placeholder="Why we own this company and where the value gets created"
              />
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button onClick={() => void createPlan()} loading={creating}>
              {creating ? "Creating…" : "Create value creation plan"}
            </Button>
            <Link href="/value-creation" className="btn btn-ghost btn-sm min-h-[44px]">
              ← All plans
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const tabProps = { planId: plan.id, plan, summary, initiatives, reload };
  const openCount = summary?.openInitiatives ?? initiatives.filter((i) => i.status !== "done" && i.status !== "deferred").length;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/value-creation"
            className="text-xs font-semibold uppercase tracking-wider text-gold-700 hover:underline dark:text-gold-400"
          >
            ← Value Creation
          </Link>
          <h2 className="mt-1 truncate font-display text-3xl font-semibold text-[#0d1f3c] dark:text-white">
            {companyName || plan.companyName || plan.name}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
            {plan.name && (companyName || plan.companyName) && plan.name !== (companyName || plan.companyName) ? `${plan.name} · ` : ""}
            Plan start {fmtDateShort(plan.planStartDate)} · Status {plan.status}
            {plan.updatedAt ? ` · Last updated ${fmtUpdated(plan.updatedAt)}` : ""}
          </p>
          {plan.thesis && (
            <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm text-slate-600 dark:text-white/70">
              <span className="font-semibold text-[#0d1f3c] dark:text-white">Thesis: </span>
              {plan.thesis}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <DataRoomButton companyId={plan.companyId} />
          <Link
            href={`/companies/${encodeURIComponent(plan.companyId)}`}
            className="btn btn-secondary btn-sm min-h-[44px]"
          >
            Company profile
          </Link>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card-surface p-4">
          <StatTile
            label="Open initiatives"
            display={String(openCount)}
            numericValue={openCount}
            format={(n) => String(n)}
            caption={`${initiatives.length} total in the plan`}
          />
        </div>
        <div className="card-surface p-4">
          <StatTile
            label="Weighted EBITDA impact"
            display={summary ? fmtMoneyN(summary.impactWeighted) : "—"}
            numericValue={summary?.impactWeighted}
            format={(n) => fmtMoneyCompact(n)}
            caption="Confidence-weighted, open initiatives"
          />
        </div>
        <div className="card-surface p-4">
          <StatTile
            label="Unweighted impact"
            display={summary ? fmtMoneyN(summary.impactUnweighted) : "—"}
            numericValue={summary?.impactUnweighted}
            format={(n) => fmtMoneyCompact(n)}
            caption="Full value if everything lands"
          />
        </div>
        <div className="card-surface p-4">
          <StatTile
            label="Exit readiness"
            display={summary?.exitOverall !== null && summary?.exitOverall !== undefined ? `${summary.exitOverall}/100` : "—"}
            numericValue={summary?.exitOverall ?? undefined}
            format={(n) => `${n}/100`}
            caption="See the Exit Readiness tab"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Value creation sections">
        {TABS.map((t) => {
          const active = tab === t.key;
          const badge = t.key === "initiatives" && openCount > 0 ? openCount : null;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => selectTab(t.key)}
              className={`chip min-h-[44px] shrink-0 ${active ? "chip-active" : ""}`}
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
        {tab === "initiatives" && <InitiativesTab {...tabProps} />}
        {tab === "timeline" && <TimelineTab {...tabProps} />}
        {tab === "matrix" && <MatrixTab {...tabProps} />}
        {tab === "playbooks" && <PlaybooksTab {...tabProps} />}
        {tab === "trees" && <TreesTab {...tabProps} />}
        {tab === "scenarios" && <ScenariosTab {...tabProps} />}
        {tab === "process-maps" && <ProcessMapsTab {...tabProps} />}
        {tab === "addons" && <AddonsTab {...tabProps} />}
        {tab === "org" && <OrgTab {...tabProps} />}
        {tab === "targets" && <TargetsTab {...tabProps} />}
        {tab === "exit" && <ExitTab {...tabProps} />}
      </div>
    </div>
  );
}
