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
 *
 * VCP REDESIGN (Oct 24, 2026): the flat tab row became grouped
 * navigation — Overview / Initiatives (Table · Board · Timeline ·
 * Matrix views) / 100-Day Plan / Playbooks & Models / Operations &
 * People / Targets & Exit — with §2 clickable summary tiles fed by
 * the stored plan summary. Every legacy tab key still resolves:
 * LEGACY_TAB_MAP maps old keys (and ?tab= deep links) onto the new
 * locations, and the session key keeps storing the legacy key of the
 * current location so old and new readers agree. Only the active
 * group's component mounts (no cross-tab fetching).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, ErrorState, SkeletonRows } from "@/components/ui";
import {
  API,
  api,
  fmtDateShort,
  fmtMoneyCompact,
  fmtMoneyN,
  fmtPayback,
  fmtUpdated,
  inputCls,
  labelCls,
  listFrom,
  paybackYears,
  todayIso,
  trackCounts,
  type Initiative,
  type PlanDetail,
  type PlanListItem,
  type PlanSummary,
  type VcPlan,
} from "@/components/valuecreation/types";
import GroupedNav, { type NavGroup } from "@/components/valuecreation/GroupedNav";
import OverviewTab from "@/components/valuecreation/OverviewTab";
import InitiativesTab from "@/components/valuecreation/InitiativesTab";
import HundredDayTab from "@/components/valuecreation/HundredDayTab";
import BaselinePanel from "@/components/valuecreation/BaselinePanel";
import PlaybooksTab from "@/components/valuecreation/PlaybooksTab";
import TreesTab from "@/components/valuecreation/TreesTab";
import ScenariosTab from "@/components/valuecreation/ScenariosTab";
import ProcessMapsTab from "@/components/valuecreation/ProcessMapsTab";
import AddonsTab from "@/components/valuecreation/AddonsTab";
import OrgTab from "@/components/valuecreation/OrgTab";
import TargetsTab from "@/components/valuecreation/TargetsTab";
import ExitTab from "@/components/valuecreation/ExitTab";
import DataRoomButton from "@/components/hubs/DataRoomButton";

/** Redesign §3 groups; Initiatives subs are its four views. */
const GROUPS: NavGroup[] = [
  { key: "overview", label: "Overview", subs: [] },
  {
    key: "initiatives",
    label: "Initiatives",
    subs: [
      { key: "table", label: "Table" },
      { key: "board", label: "Board" },
      { key: "timeline", label: "Timeline" },
      { key: "matrix", label: "Matrix" },
    ],
  },
  { key: "hundred", label: "100-Day Plan", subs: [] },
  {
    key: "playbooks-models",
    label: "Playbooks & Models",
    subs: [
      { key: "playbooks", label: "Playbooks" },
      { key: "trees", label: "Driver Trees" },
      { key: "scenarios", label: "Scenarios" },
    ],
  },
  {
    key: "ops",
    label: "Operations & People",
    subs: [
      { key: "process-maps", label: "Process Maps" },
      { key: "org", label: "Org & Talent" },
      { key: "addons", label: "Add-ons" },
    ],
  },
  {
    key: "targets-exit",
    label: "Targets & Exit",
    subs: [
      { key: "targets", label: "Targets" },
      { key: "exit", label: "Exit Readiness" },
    ],
  },
];

interface NavLoc { group: string; sub: string }

const DEFAULT_LOC: NavLoc = { group: "overview", sub: "" };

/** Every pre-redesign tab key → its new location (§3 mapping). */
const LEGACY_TAB_MAP: Record<string, NavLoc> = {
  overview: DEFAULT_LOC,
  initiatives: { group: "initiatives", sub: "table" },
  matrix: { group: "initiatives", sub: "matrix" },
  timeline: { group: "hundred", sub: "" },
  playbooks: { group: "playbooks-models", sub: "playbooks" },
  trees: { group: "playbooks-models", sub: "trees" },
  scenarios: { group: "playbooks-models", sub: "scenarios" },
  "process-maps": { group: "ops", sub: "process-maps" },
  org: { group: "ops", sub: "org" },
  addons: { group: "ops", sub: "addons" },
  targets: { group: "targets-exit", sub: "targets" },
  exit: { group: "targets-exit", sub: "exit" },
};

/** The legacy key stored for a location (session persistence compat). */
function legacyKeyOf(loc: NavLoc): string {
  for (const [key, target] of Object.entries(LEGACY_TAB_MAP)) {
    if (target.group === loc.group && target.sub === loc.sub) return key;
  }
  return "overview";
}

function locFromLegacy(key: string | null | undefined): NavLoc | null {
  if (!key) return null;
  return LEGACY_TAB_MAP[key] ?? null;
}

export default function VcWorkspace({
  companyId,
  initialTab,
}: {
  companyId: string;
  /** ?tab= deep link (legacy key or group key) from the page. */
  initialTab?: string;
}) {
  const [plan, setPlan] = useState<VcPlan | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [companyVertical, setCompanyVertical] = useState("");
  const [summary, setSummary] = useState<PlanSummary | null>(null);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "none" | "error">("loading");
  const [loc, setLoc] = useState<NavLoc>(() => locFromLegacy(initialTab) ?? DEFAULT_LOC);
  const [focusInitiativeId, setFocusInitiativeId] = useState<string | null>(null);

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
    setCompanyVertical(data.companyVertical ?? "");
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

  /* Restore the session's location for this plan (a ?tab= deep link
   * already seeded the initial state and wins over the session). */
  useEffect(() => {
    if (!plan || initialTab) return;
    try {
      const saved = window.sessionStorage.getItem(`ccp-vc-tab:${plan.id}`) ?? "";
      const restored = locFromLegacy(saved);
      if (restored) setLoc(restored);
    } catch {
      /* storage unavailable — default location stands */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  const planIdRef = useRef<string>("");
  useEffect(() => { planIdRef.current = plan?.id ?? ""; }, [plan]);

  const navigate = useCallback((group: string, sub?: string) => {
    const g = GROUPS.find((x) => x.key === group) ?? GROUPS[0];
    const next: NavLoc = { group: g.key, sub: sub ?? g.subs[0]?.key ?? "" };
    setLoc(next);
    if (planIdRef.current) {
      try {
        window.sessionStorage.setItem(`ccp-vc-tab:${planIdRef.current}`, legacyKeyOf(next));
      } catch {
        /* storage unavailable — location still switches */
      }
    }
  }, []);

  /** Overview at-risk click-through: open the initiative's drawer. */
  const openInitiative = useCallback((id: string) => {
    setFocusInitiativeId(id);
    setLoc({ group: "initiatives", sub: "table" });
  }, []);

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

  const tabProps = {
    planId: plan.id,
    plan,
    summary,
    initiatives,
    reload,
    companyVertical,
    onNavigate: navigate,
    focusInitiativeId,
    onFocusHandled: () => setFocusInitiativeId(null),
  };
  const openCount = summary?.openInitiatives ?? initiatives.filter((i) => i.status !== "done" && i.status !== "deferred").length;
  const tracks = trackCounts(summary);
  const oneTime = summary?.totalOneTimeCost ?? 0;
  const recurring = summary?.totalRecurringCost ?? 0;
  const derivedTarget =
    plan.targetEbitda ?? (plan.baselineEbitda !== null && plan.baselineEbitda !== undefined && summary
      ? plan.baselineEbitda + summary.impactUnweighted
      : null);

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

      {/* §2 summary tiles — every tile links to its view. All figures
          come from the stored plan summary + plan fields. */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <SummaryTile
          label="Baseline → target EBITDA"
          value={plan.baselineEbitda !== null && plan.baselineEbitda !== undefined
            ? `${fmtMoneyCompact(plan.baselineEbitda)} → ${derivedTarget !== null ? fmtMoneyCompact(derivedTarget) : "—"}`
            : "Not set"}
          caption={plan.targetEbitda
            ? "Baseline and target on the plan"
            : derivedTarget !== null
              ? "Target = baseline + unweighted impact · set it in Targets & Exit"
              : "Set baseline and target in Targets & Exit"}
          onClick={() => navigate("targets-exit", "targets")}
        />
        <SummaryTile
          label="Weighted EBITDA impact"
          value={summary ? fmtMoneyN(summary.impactWeighted) : "—"}
          caption={`Confidence-weighted · ${openCount} open initiatives`}
          onClick={() => navigate("initiatives", "table")}
        />
        <SummaryTile
          label="Unweighted impact"
          value={summary ? fmtMoneyN(summary.impactUnweighted) : "—"}
          caption="Full value if everything lands"
          onClick={() => navigate("initiatives", "table")}
        />
        <SummaryTile
          label="Costs & payback"
          value={fmtMoneyN(oneTime)}
          caption={`one-time · + ${fmtMoneyN(recurring)}/yr recurring · payback ${fmtPayback(paybackYears(oneTime, summary?.impactWeighted ?? 0))}`}
          onClick={() => navigate("initiatives", "table")}
        />
        <SummaryTile
          label="On track / at risk / off track"
          value={`${tracks.onTrack} / ${tracks.atRisk} / ${tracks.offTrack}`}
          caption="Open initiatives by track state"
          onClick={() => navigate("initiatives", "table")}
        />
        <SummaryTile
          label="Exit readiness"
          value={summary?.exitOverall !== null && summary?.exitOverall !== undefined ? `${summary.exitOverall}/100` : "—"}
          caption="Overall score — detail in Targets & Exit"
          onClick={() => navigate("targets-exit", "exit")}
        />
      </div>

      {/* §3 grouped navigation */}
      <div className="mt-6">
        <GroupedNav groups={GROUPS} group={loc.group} sub={loc.sub} onChange={navigate} />
      </div>

      <div className="mt-5">
        {loc.group === "overview" && (
          <OverviewTab {...tabProps} onOpenInitiative={openInitiative} />
        )}
        {loc.group === "initiatives" && (
          <InitiativesTab {...tabProps} view={loc.sub || "table"} />
        )}
        {loc.group === "hundred" && <HundredDayTab {...tabProps} />}
        {loc.group === "playbooks-models" && loc.sub === "playbooks" && <PlaybooksTab {...tabProps} />}
        {loc.group === "playbooks-models" && loc.sub === "trees" && <TreesTab {...tabProps} />}
        {loc.group === "playbooks-models" && loc.sub === "scenarios" && <ScenariosTab {...tabProps} />}
        {loc.group === "ops" && loc.sub === "process-maps" && <ProcessMapsTab {...tabProps} />}
        {loc.group === "ops" && loc.sub === "org" && <OrgTab {...tabProps} />}
        {loc.group === "ops" && loc.sub === "addons" && <AddonsTab {...tabProps} />}
        {loc.group === "targets-exit" && loc.sub === "targets" && (
          <div className="space-y-4">
            <BaselinePanel {...tabProps} />
            <TargetsTab {...tabProps} />
          </div>
        )}
        {loc.group === "targets-exit" && loc.sub === "exit" && <ExitTab {...tabProps} />}
      </div>
    </div>
  );
}

/** One §2 summary tile — a button, so the whole tile is the link. */
function SummaryTile({
  label,
  value,
  caption,
  onClick,
}: {
  label: string;
  value: string;
  caption: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card-surface min-h-[92px] p-4 text-left transition hover:border-[#b8975a]/60 hover:shadow-md"
    >
      <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-white/45">
        {label}
      </span>
      <span className="tnum mt-1 block truncate text-xl font-semibold text-[#0d1f3c] dark:text-white">
        {value}
      </span>
      <span className="mt-0.5 block text-xs text-slate-500 dark:text-white/50">{caption}</span>
    </button>
  );
}
